/**
 * `orbit run` CLI tests — with Maestro missing on this VM, the
 * command fails with the typed missing-binary error after a matching
 * pre-flow detection; a missing YAML fails loudly first.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRunCommand } from './run.js';
import { toScreenId, toTestId } from '../../domain/types.js';
import { freshNodes, writeFixtureScreenTree } from '../../test-fixtures/variants.js';

describe('runRunCommand', () => {
  let projectRoot: string;
  let dumpFile: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-run-'));
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    const platformDir = path.join(projectRoot, '.testorbit', 'android');
    fs.mkdirSync(path.join(platformDir, 'testcases'), { recursive: true });
    fs.mkdirSync(path.join(platformDir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(platformDir, 'testcases', 'login-flow.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'login-flow',
        goal: 'Log in',
        setup: { clearAppData: true, launchApp: true, disableAnimations: true },
        teardown: { clearAppData: true },
        provenance: { model: 'unknown', promptHash: 'unknown' },
        steps: [
          { index: 1, screen: 'login', variant: 'login.password', action: 'tap', elementId: 'login.submit', timeoutMs: 3000, assert: { kind: 'variant-present', variant: 'login.password' } },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(path.join(platformDir, 'tests', 'login-flow.yaml'), 'appId: com.shop.app\n---\n- launchApp:\n    clearState: true\n', 'utf8');
    dumpFile = path.join(projectRoot, 'dump.json');
    fs.writeFileSync(
      dumpFile,
      JSON.stringify({
        nodes: freshNodes(toScreenId('login'), ['login.username', 'login.password', 'login.submit', 'login.help', 'login.back']),
        display: { width: 1080, height: 2400 },
      }),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fails with the typed missing-Maestro error (no run is faked)', async () => {
    await expect(
      runRunCommand({ projectRoot, platform: 'android', testId: toTestId('login-flow'), hierarchyFile: dumpFile }),
    ).rejects.toThrow(/Maestro CLI \("maestro"\) is not installed/);
  });

  it('fails loudly when the YAML is missing', async () => {
    fs.rmSync(path.join(projectRoot, '.testorbit', 'android', 'tests', 'login-flow.yaml'));
    await expect(
      runRunCommand({ projectRoot, platform: 'android', testId: toTestId('login-flow'), hierarchyFile: dumpFile }),
    ).rejects.toThrow(/No Maestro YAML/);
  });
});
