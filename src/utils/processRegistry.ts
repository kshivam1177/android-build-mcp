import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getStateDir } from './paths.js';
import { TestOrbitFrameworkError } from '../types.js';

export interface TrackedProcess {
  id: string;
  child: ChildProcess;
  logFilePath: string;
  startedAt: string;
  targetId: string;
  kind: string;
  command: string;
}

const processes = new Map<string, TrackedProcess>();

/**
 * Spawns a long-running background process (logcat streaming, a `gradle run`
 * for gradle-module, etc.), pipes its output to a file under the state dir,
 * and tracks it in-memory for this server process's lifetime. A deliberate
 * simplification vs. a separate per-workspace daemon: state doesn't survive
 * a server restart, which is an honest tradeoff for v1, not a silent one.
 */
export function startBackgroundProcess(
  command: string,
  args: string[],
  meta: { targetId: string; kind: string; cwd?: string }
): TrackedProcess {
  const id = randomUUID();
  const dir = path.join(getStateDir(), 'background-processes');
  fs.mkdirSync(dir, { recursive: true });
  const logFilePath = path.join(dir, `${id}.log`);
  const fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  const child = spawn(command, args, { cwd: meta.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.pipe(fileStream);
  child.stderr?.pipe(fileStream);

  const tracked: TrackedProcess = {
    id,
    child,
    logFilePath,
    startedAt: new Date().toISOString(),
    targetId: meta.targetId,
    kind: meta.kind,
    command: [command, ...args].join(' '),
  };
  processes.set(id, tracked);
  child.on('close', () => {
    fileStream.end();
  });
  return tracked;
}

export function getTrackedProcess(id: string): TrackedProcess {
  const tracked = processes.get(id);
  if (!tracked) {
    throw new TestOrbitFrameworkError(
      'COMMAND_FAILED',
      `No active background process with id "${id}". It may have already been stopped, or the server restarted.`
    );
  }
  return tracked;
}

export function readCapturedLog(id: string, tailBytes = 200_000): string {
  const tracked = getTrackedProcess(id);
  const contents = fs.readFileSync(tracked.logFilePath, 'utf8');
  return contents.length > tailBytes ? contents.slice(-tailBytes) : contents;
}

export function stopTrackedProcess(id: string): { logFilePath: string } {
  const tracked = getTrackedProcess(id);
  tracked.child.kill('SIGTERM');
  processes.delete(id);
  return { logFilePath: tracked.logFilePath };
}

export function listTrackedProcesses(kind?: string): TrackedProcess[] {
  const all = Array.from(processes.values());
  return kind ? all.filter((p) => p.kind === kind) : all;
}
