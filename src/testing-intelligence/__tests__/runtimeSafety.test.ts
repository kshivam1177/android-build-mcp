import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireProjectRunLock, classifyRuntimeError, redactDiagnosticText, resolveProjectArtifactPath } from '../runtimeSafety.js';

let tempRoots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amf-runtime-safety-'));
  tempRoots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe('runtime safety helpers', () => {
  it('redacts common bearer tokens, GitHub tokens, API keys, and query credentials', () => {
    const input = 'Authorization: Bearer abcdef123 API_KEY=secret-value ghp_abcdefghijklmnopqrstuvwxyz123456 ?token=super-secret';
    const output = redactDiagnosticText(input);
    expect(output).not.toContain('abcdef123');
    expect(output).not.toContain('secret-value');
    expect(output).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(output).not.toContain('super-secret');
  });

  it('classifies known failure classes with stable codes', () => {
    expect(classifyRuntimeError('No devices/emulators found').code).toBe('DEVICE_UNAVAILABLE');
    expect(classifyRuntimeError('Gradle task failed', { phase: 'build' }).code).toBe('BUILD_FAILED');
    expect(classifyRuntimeError('Assertion failed: expected home').code).toBe('TEST_FAILED');
    expect(classifyRuntimeError('working tree is dirty', { phase: 'evidence' }).code).toBe('EVIDENCE_INCOMPLETE');
    expect(classifyRuntimeError('timed out').retryable).toBe(true);
  });

  it('keeps artifact paths inside the project root', async () => {
    const root = await tempRoot();
    expect(resolveProjectArtifactPath(root, '.testorbit/reports/a.json')).toContain('.testorbit');
    expect(() => resolveProjectArtifactPath(root, '../outside.txt')).toThrow(/inside the project root/);
    expect(() => resolveProjectArtifactPath(root, path.resolve(root, '..', 'outside.txt'))).toThrow(/inside the project root/);
  });

  it('serializes runs and refuses to steal an existing lock', async () => {
    const root = await tempRoot();
    const first = await acquireProjectRunLock(root, 'run-one');
    await expect(acquireProjectRunLock(root, 'run-two')).rejects.toMatchObject({ code: 'LOCK_CONFLICT' });
    await first.release();
    const second = await acquireProjectRunLock(root, 'run-two');
    await second.release();
  });

  it('does not let a different run release the lock', async () => {
    const root = await tempRoot();
    const lock = await acquireProjectRunLock(root, 'owner-run');
    await expect(acquireProjectRunLock(root, 'other-run')).rejects.toThrow(/holds the project lock/);
    await lock.release();
  });
});
