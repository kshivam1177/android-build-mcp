/**
 * Maestro runner tests — the subprocess adapter, with a stubbed
 * `maestro` spawner. One test uses the real default spawner on this
 * VM (Maestro is missing) to prove the typed missing-binary error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MaestroRunner } from './maestro-runner.js';

describe('MaestroRunner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-maestro-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports success on exit code 0 with no timings when debug output is absent', async () => {
    const runner = new MaestroRunner(async () => ({ stdout: 'ok\n', stderr: '', exitCode: 0 }));
    const result = await runner.runFlow(path.join(tmpDir, 'flow.yaml'), path.join(tmpDir, 'run'));
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.junitPath).toBeNull();
    expect(result.commandTimings).toEqual([]);
  });

  it('reports failure on a non-zero exit code', async () => {
    const runner = new MaestroRunner(async () => ({ stdout: '', stderr: 'boom\n', exitCode: 1 }));
    const result = await runner.runFlow(path.join(tmpDir, 'flow.yaml'), path.join(tmpDir, 'run'));
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('boom');
  });

  it('parses per-step timings from the debug-output commands file', async () => {
    const runner = new MaestroRunner(async (args) => {
      const debugAt = args.indexOf('--debug-output');
      const debugDir = args[debugAt + 1] as string;
      fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(
        path.join(debugDir, 'commands-1.json'),
        JSON.stringify([
          { command: 'tapOn', durationMs: 120, status: 'passed' },
          { command: 'assertVisible', durationMs: 300, status: 'failed' },
        ]),
        'utf8',
      );
      return { stdout: '', stderr: '', exitCode: 1 };
    });
    const result = await runner.runFlow(path.join(tmpDir, 'flow.yaml'), path.join(tmpDir, 'run'));
    expect(result.commandTimings).toEqual([
      { command: 'tapOn', durationMs: 120, status: 'passed' },
      { command: 'assertVisible', durationMs: 300, status: 'failed' },
    ]);
  });

  it('fails with a typed error naming the missing binary when Maestro is absent', async () => {
    const runner = new MaestroRunner();
    await expect(runner.runFlow(path.join(tmpDir, 'flow.yaml'), path.join(tmpDir, 'run'))).rejects.toThrow(
      /Maestro CLI \("maestro"\) is not installed/,
    );
  });
});
