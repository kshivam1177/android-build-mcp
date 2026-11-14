import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type RuntimeErrorCode =
  | 'BUILD_FAILED'
  | 'DEVICE_UNAVAILABLE'
  | 'TEST_FAILED'
  | 'EVIDENCE_INCOMPLETE'
  | 'TOOLCHAIN_MISSING'
  | 'LOCK_CONFLICT'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface ClassifiedRuntimeError {
  code: RuntimeErrorCode;
  retryable: boolean;
  message: string;
}

/** Remove common credential forms before diagnostic output is persisted. */
export function redactDiagnosticText(input: string): string {
  return input
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\b\s*[:=]\s*)["']?[^\s,"']+["']?/gi, '$1[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_API_KEY]')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]');
}

/** Classify failures into stable machine-readable categories for agents and CI. */
export function classifyRuntimeError(message: string, context: {
  phase?: 'build' | 'device' | 'test' | 'evidence' | 'toolchain' | 'cancel';
} = {}): ClassifiedRuntimeError {
  const value = message.toLowerCase();
  if (context.phase === 'cancel' || /cancelled by user|operation cancelled|aborterror/.test(value)) {
    return { code: 'CANCELLED', retryable: false, message: redactDiagnosticText(message) };
  }
  if (/timed? out|timeout|etimedout/.test(value)) {
    return { code: 'TIMEOUT', retryable: true, message: redactDiagnosticText(message) };
  }
  if (context.phase === 'toolchain' || /command not found|not recognized as an internal|sdk location.*not found|adb.*not found|flutter.*not found|gradle.*not found/.test(value)) {
    return { code: 'TOOLCHAIN_MISSING', retryable: false, message: redactDiagnosticText(message) };
  }
  if (context.phase === 'device' || /no devices|device offline|device unauthorized|failed to connect.*device|more than one device/.test(value)) {
    return { code: 'DEVICE_UNAVAILABLE', retryable: true, message: redactDiagnosticText(message) };
  }
  if (context.phase === 'build' || /build failed|compilation failed|compile.*error|gradle task.*failed/.test(value)) {
    return { code: 'BUILD_FAILED', retryable: false, message: redactDiagnosticText(message) };
  }
  if (context.phase === 'evidence' || /evidence.*incomplete|git head.*unavailable|working tree.*dirty|missing.*summary\.json/.test(value)) {
    return { code: 'EVIDENCE_INCOMPLETE', retryable: false, message: redactDiagnosticText(message) };
  }
  if (context.phase === 'test' || /assertion failed|test failed|expected .* but (got|was)|ui assertion/.test(value)) {
    return { code: 'TEST_FAILED', retryable: false, message: redactDiagnosticText(message) };
  }
  return { code: 'UNKNOWN', retryable: false, message: redactDiagnosticText(message) };
}

/** Resolve an artifact path and reject traversal outside the project root. */
export function resolveProjectArtifactPath(projectRoot: string, relativePath: string): string {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('Artifact path must remain inside the project root.');
  }
  return target;
}

export interface ProjectRunLock {
  lockPath: string;
  runId: string;
  release: () => Promise<void>;
}

/**
 * Atomic directory creation provides a cross-process project lock. Never
 * silently steals a lock: an operator must inspect the owner before cleanup.
 */
export async function acquireProjectRunLock(projectRoot: string, runId: string = randomUUID()): Promise<ProjectRunLock> {
  const root = path.resolve(projectRoot);
  const lockPath = path.join(root, '.testorbit', '.run-lock');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await fs.mkdir(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      let owner = 'owner metadata unavailable';
      try { owner = await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8'); } catch { /* concurrent creator may still be writing */ }
      throw Object.assign(new Error('Another TestOrbit run holds the project lock. Inspect .testorbit/.run-lock before removing it. ' + redactDiagnosticText(owner)), { code: 'LOCK_CONFLICT' });
    }
    throw error;
  }
  const owner = { schemaVersion: 1, runId, pid: process.pid, startedAt: new Date().toISOString() };
  await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(owner, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  let released = false;
  return {
    lockPath,
    runId,
    release: async () => {
      if (released) return;
      released = true;
      let current: { runId?: string } | undefined;
      try { current = JSON.parse(await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8')) as { runId?: string }; } catch { return; }
      if (current.runId !== runId) throw new Error('Refusing to release a project lock owned by a different run.');
      await fs.rm(lockPath, { recursive: true, force: false });
    },
  };
}
