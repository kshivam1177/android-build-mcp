/**
 * Shared recording-reader tests (B8) — v1 loads with the "unproven"
 * label, v2 loads, v3 is rejected, and path resolution prefers the
 * platform-wise folder over the legacy flat folder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRecording, readRecordingFile, resolveRecordingPath } from './recording-reader.js';

/** Write a recording fixture under the project root. */
function writeRecording(projectRoot: string, relativePath: string, schemaVersion: number): string {
  const file = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion,
      flowId: 'login-flow',
      deviceId: 'emulator-5554',
      startedAt: '2026-11-13T00:00:00.000Z',
      stoppedAt: '2026-11-13T00:01:00.000Z',
      durationMs: 1000,
      actions: [{ id: 'tap-1', type: 'tap', timestamp: '2026-11-13T00:00:01.000Z', durationMs: 1 }],
      screenshots: {},
    }),
    'utf8',
  );
  return file;
}

describe('recording reader', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-reader-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reads v1 and labels it unproven / start-stop only', () => {
    const file = writeRecording(projectRoot, '.testorbit/recordings/login-flow.json', 1);
    const result = readRecordingFile(file);
    expect(result.version).toBe(1);
    expect(result.edgeNote).toContain('unproven / start-stop only');
  });

  it('reads v2 and rejects v3 explicitly', () => {
    const file = writeRecording(projectRoot, '.testorbit/recordings/login-flow.json', 2);
    expect(readRecordingFile(file).version).toBe(2);
    const bad = writeRecording(projectRoot, '.testorbit/recordings/bad.json', 3);
    expect(() => readRecordingFile(bad)).toThrow(/schemaVersion 3/);
  });

  it('prefers the platform-wise path over the legacy flat path', () => {
    writeRecording(projectRoot, '.testorbit/recordings/login-flow.json', 1);
    const platformFile = writeRecording(projectRoot, '.testorbit/android/recordings/login-flow.json', 2);
    expect(resolveRecordingPath(projectRoot, 'android', 'login-flow')).toBe(platformFile);
    expect(readRecording(projectRoot, 'android', 'login-flow').version).toBe(2);
  });

  it('falls back to the flat path and fails loudly when neither exists', () => {
    writeRecording(projectRoot, '.testorbit/recordings/login-flow.json', 1);
    expect(readRecording(projectRoot, 'android', 'login-flow').version).toBe(1);
    expect(() => readRecording(projectRoot, 'android', 'missing')).toThrow(/No recording "missing"/);
  });
});
