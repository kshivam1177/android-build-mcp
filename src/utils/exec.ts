import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { AndroidBuildMcpError } from '../types.js';
import type { ExecResult } from '../types.js';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Piped to the child's stdin, then the stream is closed. */
  input?: string;
  /** Cancels the child process and rejects with a structured cancellation error. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const KILL_GRACE_MS = 1_000;

interface CollectedResult<T> {
  stdout: T;
  stderr: string;
  exitCode: number;
  command: string;
  durationMs: number;
}

/**
 * Run a command with an argv array - never through a shell. Cancellation and
 * timeout both terminate the child; a second kill is sent if it ignores
 * SIGTERM. The promise rejects immediately on cancellation/timeout while
 * listeners and timers are cleaned when the child exits.
 */
function execute<T>(
  command: string,
  args: string[],
  options: ExecOptions,
  collect: (child: ChildProcess) => Promise<T>
): Promise<CollectedResult<T>> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const displayCommand = [command, ...args].join(' ');

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new AndroidBuildMcpError('COMMAND_FAILED', `Command cancelled before start: ${displayCommand}`, { command: displayCommand, cancelled: true }));
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(new AndroidBuildMcpError('COMMAND_FAILED', `Failed to start command: ${displayCommand} (${(error as Error).message})`, { command: displayCommand }));
      return;
    }

    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill('SIGTERM'); } catch { /* Process may already be gone. */ }
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
        }
      }, KILL_GRACE_MS);
      forceKillTimer.unref?.();
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
      terminate();
    };
    const onAbort = () => {
      cancelled = true;
      rejectOnce(new AndroidBuildMcpError('COMMAND_FAILED', `Command cancelled: ${displayCommand}`, { command: displayCommand, cancelled: true }));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      rejectOnce(new AndroidBuildMcpError('TIMEOUT', `Command timed out after ${timeoutMs}ms: ${displayCommand}`, { command: displayCommand, timeoutMs }));
    }, timeoutMs);
    timeoutTimer.unref?.();

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error.code === 'ENOENT') {
        reject(new AndroidBuildMcpError('COMMAND_FAILED', `Executable not found on PATH: ${command}`, { command: displayCommand }));
      } else {
        reject(new AndroidBuildMcpError('COMMAND_FAILED', `Failed to run command: ${displayCommand} (${error.message})`, { command: displayCommand }));
      }
    });

    child.on('close', async (code) => {
      cleanup();
      if (settled) return;
      settled = true;
      if (cancelled || timedOut) return;
      try {
        const stdout = await collect(child);
        resolve({ stdout, stderr: '', exitCode: code ?? -1, command: displayCommand, durationMs: Date.now() - start });
      } catch (error) {
        reject(error);
      }
    });

    if (options.input !== undefined) child.stdin?.write(options.input);
    child.stdin?.end();
  });
}

export function execCommand(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return execute(command, args, options, async (child) => {
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    // The close event can fire before this collector resolves if attached late;
    // output is collected by the streaming listeners below in the shared path.
    return Buffer.concat(chunks).toString('utf8') + stderr;
  }).then((result) => {
    const separator = '\u0000AMF_STDERR\u0000';
    const split = result.stdout.indexOf(separator);
    return {
      stdout: split < 0 ? result.stdout : result.stdout.slice(0, split),
      stderr: split < 0 ? '' : result.stdout.slice(split + separator.length),
      exitCode: result.exitCode, command: result.command, durationMs: result.durationMs
    };
  });
}

export interface ExecBinaryResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  command: string;
  durationMs: number;
}

export function execCommandBinary(command: string, args: string[], options: ExecOptions = {}): Promise<ExecBinaryResult> {
  return execute(command, args, options, async (child) => {
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    return Buffer.concat(chunks);
  }).then((result) => ({
    stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode,
    command: result.command, durationMs: result.durationMs
  }));
}
