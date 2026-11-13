/**
 * Rename-screen tests (Phase 6, D11) — a rename rewrites the folder,
 * screen.json, elements, variant files (and their names), recordings,
 * test cases, env-var names, and the regenerated map, keeps a backup,
 * and aborts before writing anything when a reference cannot be
 * rewritten. Fixture screens/recordings/tests only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckMapUseCase } from './check-map.js';
import { RenameScreenUseCase } from './rename-screen.js';
import { toScreenId } from '../domain/types.js';
import { writeFixtureScreenTree } from '../test-fixtures/variants.js';

/** Platform-relative helper: `<platform>/<rel>` under the fixture root. */
function platformPath(projectRoot: string, rel: string): string {
  return path.join(projectRoot, '.testorbit', 'android', rel);
}

/** Write screen.json, form-spec.json, and a stale `.bak` for login. */
function writeLoginExtras(projectRoot: string): void {
  const screenDir = platformPath(projectRoot, 'screens/login');
  fs.writeFileSync(
    path.join(screenDir, 'screen.json'),
    JSON.stringify({ schemaVersion: 2, screenId: 'login', title: 'Login', appPackage: 'com.shop.app' }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(screenDir, 'form-spec.json'),
    JSON.stringify({ submitButton: 'login.submit' }),
    'utf8',
  );
  fs.copyFileSync(path.join(screenDir, 'elements.json'), path.join(screenDir, 'elements.json.bak'));
}

/** Write a v2 recording and a test case + YAML + env manifest for login. */
function writeLoginReferences(projectRoot: string): void {
  const recordingsDir = platformPath(projectRoot, 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(recordingsDir, 'login-flow.json'),
    JSON.stringify({
      schemaVersion: 2,
      flowId: 'login-flow',
      deviceId: 'emulator-5554',
      platform: 'android',
      startedAt: '2026-11-13T10:00:00.000Z',
      stoppedAt: '2026-11-13T10:01:00.000Z',
      durationMs: 1000,
      actions: [
        { id: 'tap-1', type: 'tap', timestamp: '2026-11-13T10:00:01.000Z', durationMs: 100, selector: { resourceId: 'com.shop.app:id/submit' }, screenId: 'login', variantId: 'login.password', elementId: 'login.submit', isNavigationStep: false },
        { id: 'type-1', type: 'type_text', timestamp: '2026-11-13T10:00:02.000Z', durationMs: 100, selector: { resourceId: 'com.shop.app:id/password' }, screenId: 'login', variantId: 'login.password', elementId: 'login.password', isNavigationStep: false },
      ],
      screenshots: {},
    }),
    'utf8',
  );
  const testcasesDir = platformPath(projectRoot, 'testcases');
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
        { index: 1, screen: 'login', variant: 'login.password', action: 'type', elementId: 'login.password', timeoutMs: 3000, text: '${TEST_LOGIN_PASSWORD}', assert: { kind: 'variant-present', variant: 'login.password' } },
        { index: 2, screen: 'login', variant: 'login.password', action: 'tap', elementId: 'login.submit', timeoutMs: 3000, assert: { kind: 'variant-present', variant: 'login.password' } },
      ],
    }),
    'utf8',
  );
  fs.writeFileSync(path.join(testcasesDir, 'login-flow.env.example'), 'TEST_LOGIN_PASSWORD=\n', 'utf8');
  const testsDir = platformPath(projectRoot, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(
    path.join(testsDir, 'login-flow.yaml'),
    'appId: com.shop.app\n---\n- inputText: "${TEST_LOGIN_PASSWORD}"\n- tapOn: { id: "com.shop.app:id/submit" }\n',
    'utf8',
  );
}

/** Build the full rename fixture: login (+checkout) trees and references. */
function buildFixture(projectRoot: string): void {
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
  writeLoginExtras(projectRoot);
  writeLoginReferences(projectRoot);
}

/** Assert the renamed screen's own files (folder, json, variants). */
function expectScreenFilesRenamed(projectRoot: string): void {
  expect(fs.existsSync(platformPath(projectRoot, 'screens/signin'))).toBe(true);
  expect(fs.existsSync(platformPath(projectRoot, 'screens/login'))).toBe(false);
  expect(fs.existsSync(platformPath(projectRoot, 'screens/signin/variants/signin.password.json'))).toBe(true);
  expect(fs.existsSync(platformPath(projectRoot, 'screens/signin/variants/login.password.json'))).toBe(false);
  const screenJson = JSON.parse(
    fs.readFileSync(platformPath(projectRoot, 'screens/signin/screen.json'), 'utf8'),
  ) as { screenId: string };
  expect(screenJson.screenId).toBe('signin');
  const elements = fs.readFileSync(platformPath(projectRoot, 'screens/signin/elements.json'), 'utf8');
  expect(elements).toContain('signin.submit');
  expect(elements).not.toContain('login.');
  const variant = JSON.parse(
    fs.readFileSync(platformPath(projectRoot, 'screens/signin/variants/signin.password.json'), 'utf8'),
  ) as { variantId: string; required: string[] };
  expect(variant.variantId).toBe('signin.password');
  expect(variant.required).toContain('signin.submit');
  expect(fs.existsSync(platformPath(projectRoot, 'screens/signin/elements.json.bak'))).toBe(false);
}

/** Assert recordings, test cases, YAML, and the map carry the new id only. */
function expectReferencesRenamed(projectRoot: string, mapPath: string): void {
  const recording = fs.readFileSync(platformPath(projectRoot, 'recordings/login-flow.json'), 'utf8');
  expect(recording).toContain('signin.password');
  expect(recording).not.toContain('login.');
  const testCase = fs.readFileSync(platformPath(projectRoot, 'testcases/login-flow.json'), 'utf8');
  expect(testCase).toContain('${TEST_SIGNIN_PASSWORD}');
  expect(testCase).not.toContain('TEST_LOGIN_');
  const yaml = fs.readFileSync(platformPath(projectRoot, 'tests/login-flow.yaml'), 'utf8');
  expect(yaml).toContain('${TEST_SIGNIN_PASSWORD}');
  const map = fs.readFileSync(mapPath, 'utf8');
  expect(map).toContain('signin');
  expect(map).not.toContain('login');
}

/** Run the rename fixture. */
function renameLogin(projectRoot: string): ReturnType<RenameScreenUseCase['rename']> {
  return new RenameScreenUseCase().rename({
    projectRoot,
    platform: 'android',
    fromScreenId: toScreenId('login'),
    toScreenId: toScreenId('signin'),
  });
}

describe('RenameScreenUseCase success', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-rename-'));
    buildFixture(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('rewrites every reference and regenerates a map with no old id', () => {
    const result = renameLogin(projectRoot);
    expectScreenFilesRenamed(projectRoot);
    expectReferencesRenamed(projectRoot, result.mapPath);
    expect(fs.existsSync(result.backupPath)).toBe(true);
  });

  it('keeps the old ids in the backup', () => {
    const result = renameLogin(projectRoot);
    const backedUp = fs.readFileSync(path.join(result.backupPath, 'screens', 'login', 'elements.json'), 'utf8');
    expect(backedUp).toContain('login.submit');
  });

  it('leaves the renamed variants passing check-screen-map (fresh stamps)', () => {
    renameLogin(projectRoot);
    const { report } = new CheckMapUseCase().check({ projectRoot, platform: 'android' });
    expect(report.findings.filter((entry) => entry.rule === 'FINGERPRINT_STAMP_MISMATCH')).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

describe('RenameScreenUseCase refusal', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-rename-'));
    buildFixture(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('refuses to rename onto an existing screen and changes nothing', () => {
    expect(() =>
      new RenameScreenUseCase().rename({
        projectRoot,
        platform: 'android',
        fromScreenId: toScreenId('login'),
        toScreenId: toScreenId('checkout'),
      }),
    ).toThrow(/already has a learned folder/);
    expect(fs.existsSync(platformPath(projectRoot, 'screens/login'))).toBe(true);
    expect(fs.existsSync(platformPath(projectRoot, 'screens/checkout'))).toBe(true);
  });

  it('refuses to rename a screen that does not exist', () => {
    expect(() =>
      new RenameScreenUseCase().rename({
        projectRoot,
        platform: 'android',
        fromScreenId: toScreenId('missing'),
        toScreenId: toScreenId('signin'),
      }),
    ).toThrow(/no learned folder/);
  });

  it('aborts before writing anything when a recording is unparseable', () => {
    fs.writeFileSync(
      platformPath(projectRoot, 'recordings/broken.json'),
      '{ not json',
      'utf8',
    );
    expect(() => renameLogin(projectRoot)).toThrow(/not valid JSON/);
    expect(fs.existsSync(platformPath(projectRoot, 'screens/login'))).toBe(true);
    expect(fs.existsSync(platformPath(projectRoot, 'screens/signin'))).toBe(false);
  });
});
