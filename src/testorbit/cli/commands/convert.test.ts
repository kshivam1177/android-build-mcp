/**
 * `orbit convert` CLI tests — a fixture v1 recording converts via
 * the command and writes JSON + YAML.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConvertCommand } from './convert.js';
import { toScreenId, toTestId } from '../../domain/types.js';
import { writeFixtureScreenTree } from '../../test-fixtures/variants.js';

describe('runConvertCommand', () => {
  let projectRoot: string;
  let output: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-convert-'));
    output = '';
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    const recordingsDir = path.join(projectRoot, '.testorbit', 'android', 'recordings');
    fs.mkdirSync(recordingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(recordingsDir, 'login-flow.json'),
      JSON.stringify({
        schemaVersion: 1,
        flowId: 'login-flow',
        deviceId: 'emulator-5554',
        startedAt: '2026-11-13T00:00:00.000Z',
        stoppedAt: '2026-11-13T00:01:00.000Z',
        durationMs: 1000,
        actions: [
          { id: 'tap-1', type: 'tap', timestamp: '2026-11-13T00:00:01.000Z', durationMs: 100, selector: { resourceId: 'com.shop.app:id/submit' } },
        ],
        screenshots: {},
      }),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('converts the recording and prints the output paths', async () => {
    const code = await runConvertCommand({
      projectRoot,
      platform: 'android',
      flowId: 'login-flow',
      testId: toTestId('login-flow'),
      appId: 'com.shop.app',
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('login-flow.yaml');
    expect(fs.existsSync(path.join(projectRoot, '.testorbit', 'android', 'tests', 'login-flow.yaml'))).toBe(true);
  });
});
