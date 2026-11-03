import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { AndroidBuildMcpError } from '../types.js';
import type { ExecResult } from '../types.js';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const KILL_GRACE_MS = 1_000;

interface RawExecResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  command: string;
  durationMs: number;
}

/** Shell-free process execution with timeout and AbortSignal cancellation. */
function execute(command: string, args: string[], options: ExecOptions): Promise<RawExecResult> {
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
      child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, shell: false });
    } catch (error) {
      reject(new AndroidBuildMcpError('COMMAND_FAILED', `Failed to start command: ${displayCommand} (${(error as Error).message})`, { command: displayCommand }));
      return;
    }

    const stdout: Buffer[] = [];
    let stderr = '';
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill('SIGTERM'); } catch { /* Child may have exited. */ }
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* Child may have exited. */ }
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
    const onAbort = () => rejectOnce(new AndroidBuildMcpError(
      'COMMAND_FAILED', `Command cancelled: ${displayCommand}`, { command: displayCommand, cancelled: true }
    ));

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
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
    child.on('close', (code) => {
      cleanup();
      if (settled) return;
      settled = true;
      resolve({ stdout: Buffer.concat(stdout), stderr, exitCode: code ?? -1, command: displayCommand, durationMs: Date.now() - start });
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });
    timeoutTimer = setTimeout(() => rejectOnce(new AndroidBuildMcpError(
      'TIMEOUT', `Command timed out after ${timeoutMs}ms: ${displayCommand}`, { command: displayCommand, timeoutMs }
    )), timeoutMs);
    timeoutTimer.unref?.();
    if (options.input !== undefined) child.stdin?.write(options.input);
    child.stdin?.end();
  });
}

export function execCommand(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return execute(command, args, options).then((result) => ({
    stdout: result.stdout.toString('utf8'), stderr: result.stderr,
    exitCode: result.exitCode, command: result.command, durationMs: result.durationMs
  }));
}

export interface ExecBinaryResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  command: string;
  durationMs: number;
}

export function execCommandBinary(command: string, args: string[], options: ExecOptions = {}): Promise<ExecBinaryResult> {
  return execute(command, args, options);
}
