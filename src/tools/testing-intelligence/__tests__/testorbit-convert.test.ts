/**
 * TestOrbit Phase 4 tool tests — `orbit_convert_recording` (testing-intelligence
 * workflow) converts a fixture v1 recording via the shared reader, and
 * `save_test_case` writes schema v2 with setup/teardown/provenance.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { register as registerConvertRecording } from '../orbit_convert_recording.js';
import { register as registerCopyTestCase } from '../orbit_copy_test_case.js';
import { register as registerSaveTestCase } from '../save_test_case.js';

describe('orbit_convert_recording tool', () => {
  let tmpDir: string;
  let convertHandler: (...args: unknown[]) => unknown;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-tool-'));
    const mockServer = {
      registerTool: (_name: string, _def: unknown, handler: (...args: unknown[]) => unknown) => handler,
    } as never;
    convertHandler = registerConvertRecording(mockServer);
    const screensDir = path.join(tmpDir, '.testorbit', 'android', 'screens', 'login', 'variants');
    fs.mkdirSync(screensDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.testorbit', 'android', 'screens', 'login', 'elements.json'),
      JSON.stringify([
        { id: 'login.submit', stableSelector: { resourceId: 'com.shop.app:id/submit' }, clickable: true, enabled: true },
      ]),
      'utf8',
    );
    fs.writeFileSync(
      path.join(screensDir, 'default.json'),
      JSON.stringify({
        schemaVersion: 2,
        screenId: 'login',
        variantId: 'default',
        required: ['login.submit'],
        optional: [],
        excluded: [],
        fingerprintStamp: `sha256:${'a'.repeat(64)}`,
        learnedAt: '2026-11-13T00:00:00.000Z',
      }),
      'utf8',
    );
    const recordingsDir = path.join(tmpDir, '.testorbit', 'android', 'recordings');
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('converts a v1 recording to JSON + YAML and reports the edge note', async () => {
    const result = await convertHandler({
      projectPath: tmpDir,
      flowId: 'login-flow',
      testId: 'login-flow',
      platform: 'android',
      appId: 'com.shop.app',
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.testId).toBe('login-flow');
    expect(result.structuredContent.recordingVersion).toBe(1);
    expect(result.structuredContent.edgeNote).toContain('unproven / start-stop only');
    const yamlPath = path.join(tmpDir, '.testorbit', 'android', 'tests', 'login-flow.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);
    expect(fs.readFileSync(yamlPath, 'utf8')).toContain('tapOn:');
  });
});

describe('orbit_copy_test_case tool', () => {
  let tmpDir: string;
  let copyHandler: (...args: unknown[]) => unknown;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-tool-copy-'));
    const mockServer = {
      registerTool: (_name: string, _def: unknown, handler: (...args: unknown[]) => unknown) => handler,
    } as never;
    copyHandler = registerCopyTestCase(mockServer);
    const stamp = `sha256:${'a'.repeat(64)}`;
    for (const platform of ['android', 'ios'] as const) {
      const screenDir = path.join(tmpDir, '.testorbit', platform, 'screens', 'login', 'variants');
      fs.mkdirSync(screenDir, { recursive: true });
      const pkg = platform === 'android' ? 'com.shop.app' : 'com.shop.ios';
      const rid = platform === 'android' ? 'com.shop.app:id/submit' : 'com.shop.ios:id/submit';
      fs.writeFileSync(
        path.join(tmpDir, '.testorbit', platform, 'screens', 'login', 'screen.json'),
        JSON.stringify({ schemaVersion: 2, screenId: 'login', appPackage: pkg }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(tmpDir, '.testorbit', platform, 'screens', 'login', 'elements.json'),
        JSON.stringify([
          { id: 'login.submit', stableSelector: { resourceId: rid, contentDesc: 'Log in' }, clickable: true, enabled: true },
          { id: 'login.help', stableSelector: { resourceId: `${pkg}:id/help`, contentDesc: 'Help' }, clickable: true, enabled: true },
        ]),
        'utf8',
      );
      fs.writeFileSync(
        path.join(screenDir, 'default.json'),
        JSON.stringify({ schemaVersion: 2, screenId: 'login', variantId: 'default', required: ['login.help'], optional: [], excluded: [], fingerprintStamp: stamp, learnedAt: '2026-11-13T00:00:00.000Z' }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(screenDir, 'login.password.json'),
        JSON.stringify({ schemaVersion: 2, screenId: 'login', variantId: 'login.password', required: ['login.submit'], optional: [], excluded: [], fingerprintStamp: stamp, learnedAt: '2026-11-13T00:00:00.000Z' }),
        'utf8',
      );
    }
    const testcasesDir = path.join(tmpDir, '.testorbit', 'android', 'testcases');
    fs.mkdirSync(testcasesDir, { recursive: true });
    fs.writeFileSync(
      path.join(testcasesDir, 'login-flow.json'),
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
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies the test to iOS and marks it copied-unverified', async () => {
    const result = await copyHandler({
      projectPath: tmpDir,
      testId: 'login-flow',
      fromPlatform: 'android',
      toPlatform: 'ios',
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.verificationStatus).toBe('copied-unverified');
    expect(fs.existsSync(path.join(tmpDir, '.testorbit', 'ios', 'tests', 'login-flow.yaml'))).toBe(true);
  });
});

describe('save_test_case schema v2', () => {
  let tmpDir: string;
  let saveHandler: (...args: unknown[]) => unknown;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-save-'));
    const mockServer = {
      registerTool: (_name: string, _def: unknown, handler: (...args: unknown[]) => unknown) => handler,
    } as never;
    saveHandler = registerSaveTestCase(mockServer);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes schemaVersion 2 with setup, teardown, provenance, and step assert', async () => {
    const result = await saveHandler({
      projectPath: tmpDir,
      id: 'TC-TESTORBIT-1',
      title: 'TestOrbit flow',
      description: 'Converted flow',
      steps: [
        {
          stepNumber: 1,
          description: 'Tap submit',
          action: 'tap',
          target: 'login.submit',
          timeoutMs: 10000,
          assert: { kind: 'variant-present', variant: 'login.password' },
        },
      ],
    });
    expect(result.isError).toBeFalsy();
    const saved = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.testorbit', 'testcases', 'tc-testorbit-1.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(saved['schemaVersion']).toBe(2);
    expect(saved['setup']).toEqual({ clearAppData: true, launchApp: true, disableAnimations: true });
    expect(saved['teardown']).toEqual({ clearAppData: true });
    expect(saved['provenance']).toEqual({ model: 'unknown', promptHash: 'unknown' });
    const steps = saved['steps'] as Record<string, unknown>[];
    expect(steps[0]?.['timeoutMs']).toBe(10000);
    expect(steps[0]?.['assert']).toEqual({ kind: 'variant-present', variant: 'login.password' });
  });
});
