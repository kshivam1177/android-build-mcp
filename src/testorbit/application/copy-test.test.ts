/**
 * Cross-platform copy tests (C4) — all elements mapped copies and
 * regenerates valid target YAML marked copied-unverified; one
 * unmapped element fails loudly naming the step; contentDesc is the
 * fallback when resourceIds differ per platform. Fixture data only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CopyTestUseCase } from './copy-test.js';
import { ConvertRecordingUseCase } from './convert-recording.js';
import { parseMaestroYaml } from '../domain/maestro-schema.js';
import type { TestOrbitRecordingDocument } from '../domain/recording-schemas.js';
import { toScreenId, toTestId } from '../domain/types.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import { writeFixtureScreenTree } from '../test-fixtures/variants.js';

/** Write one iOS variant file. */
function writeIosVariant(screenDir: string, variantId: string, required: string[], stamp: string): void {
  fs.writeFileSync(
    path.join(screenDir, `${variantId}.json`),
    JSON.stringify({
      schemaVersion: 2,
      screenId: 'login',
      variantId,
      required,
      optional: [],
      excluded: [],
      fingerprintStamp: stamp,
      learnedAt: '2026-11-13T00:00:00.000Z',
    }),
    'utf8',
  );
}

/** Write the iOS target tree: same ids, iOS-style resourceIds, shared contentDesc. */
function writeIosTree(projectRoot: string): void {
  const screenDir = path.join(projectRoot, '.testorbit', 'ios', 'screens', 'login', 'variants');
  fs.mkdirSync(screenDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.testorbit', 'ios', 'screens', 'login', 'screen.json'),
    JSON.stringify({ schemaVersion: 2, screenId: 'login', appPackage: 'com.shop.ios' }),
    'utf8',
  );
  const iosElement = (id: string, desc: string): Record<string, unknown> => ({
    id,
    stableSelector: { resourceId: `com.shop.ios:id/${id.split('.')[1]}`, contentDesc: desc },
    clickable: true,
    enabled: true,
  });
  fs.writeFileSync(
    path.join(projectRoot, '.testorbit', 'ios', 'screens', 'login', 'elements.json'),
    JSON.stringify([
      iosElement('login.username', 'Username'),
      iosElement('login.password', 'Password'),
      iosElement('login.submit', 'Log in'),
      iosElement('login.help', 'Help'),
      iosElement('login.back', 'Back'),
    ]),
    'utf8',
  );
  writeIosVariant(screenDir, 'default', ['login.help'], `sha256:${'a'.repeat(64)}`);
  writeIosVariant(screenDir, 'login.password', ['login.username', 'login.password', 'login.submit'], `sha256:${'b'.repeat(64)}`);
}

/** Give the Android source tree contentDesc values (learned elements carry them when present). */
function addContentDescToAndroidTree(projectRoot: string): void {
  const elementsPath = path.join(projectRoot, '.testorbit', 'android', 'screens', 'login', 'elements.json');
  const elements = JSON.parse(fs.readFileSync(elementsPath, 'utf8')) as {
    id: string;
    stableSelector: Record<string, string>;
  }[];
  const descs: Record<string, string> = {
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Log in',
    'login.help': 'Help',
    'login.back': 'Back',
  };
  for (const element of elements) {
    const desc = descs[element.id];
    if (desc !== undefined) element.stableSelector['contentDesc'] = desc;
  }
  fs.writeFileSync(elementsPath, JSON.stringify(elements, null, 2), 'utf8');
}

/** Build the source Android test case via the converter (fixture recording). */
function buildSourceTest(projectRoot: string): void {
  const recording: TestOrbitRecordingDocument = {
    schemaVersion: 1,
    flowId: 'login-flow',
    deviceId: 'emulator-5554',
    startedAt: '2026-11-13T00:00:00.000Z',
    stoppedAt: '2026-11-13T00:01:00.000Z',
    durationMs: 1000,
    actions: [
      { id: 'tap-1', type: 'tap', timestamp: '2026-11-13T00:00:01.000Z', durationMs: 100, selector: { resourceId: 'com.shop.app:id/submit', contentDesc: 'Log in' } },
    ],
    screenshots: {},
  };
  new ConvertRecordingUseCase(new VariantStore(projectRoot, 'android')).convert({
    projectRoot,
    platform: 'android',
    recording,
    testId: toTestId('login-flow'),
    appId: 'com.shop.app',
  });
}

/** Remove one element from the iOS learned elements (unmappable fixture). */
function removeIosElement(projectRoot: string, elementId: string): void {
  const elementsPath = path.join(projectRoot, '.testorbit', 'ios', 'screens', 'login', 'elements.json');
  const elements = JSON.parse(fs.readFileSync(elementsPath, 'utf8')) as Record<string, unknown>[];
  fs.writeFileSync(
    elementsPath,
    JSON.stringify(elements.filter((element) => element['id'] !== elementId)),
    'utf8',
  );
}

/** Build the full copy fixture: Android source tree + iOS tree + source test. */
function buildCopyFixture(projectRoot: string): void {
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  addContentDescToAndroidTree(projectRoot);
  writeIosTree(projectRoot);
  buildSourceTest(projectRoot);
}

describe('CopyTestUseCase', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-copy-'));
    buildCopyFixture(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('copies via the contentDesc fallback and marks the copy unverified', () => {
    const result = new CopyTestUseCase().copy({
      projectRoot,
      fromPlatform: 'android',
      toPlatform: 'ios',
      testId: toTestId('login-flow'),
    });
    expect(result.testCase.verificationStatus).toBe('copied-unverified');
    expect(result.testCase.provenance.copiedFrom).toEqual({ platform: 'android', testId: 'login-flow' });
    expect(result.testCase.steps[0]?.elementId).toBe('login.submit');
    const flow = parseMaestroYaml(result.yamlText);
    expect(flow.config.appId).toBe('com.shop.ios');
    expect(flow.commands).toContainEqual({ tapOn: { id: 'com.shop.ios:id/submit' } });
    expect(fs.existsSync(result.testCasePath)).toBe(true);
  });

  it('copies under a new id with --as', () => {
    const result = new CopyTestUseCase().copy({
      projectRoot,
      fromPlatform: 'android',
      toPlatform: 'ios',
      testId: toTestId('login-flow'),
      newTestId: toTestId('login-flow-ios'),
    });
    expect(result.testCase.id).toBe('login-flow-ios');
    expect(result.testCasePath).toContain('login-flow-ios.json');
  });

  it('fails loudly naming the step when an element has no target match', () => {
    removeIosElement(projectRoot, 'login.submit');
    expect(() =>
      new CopyTestUseCase().copy({
        projectRoot,
        fromPlatform: 'android',
        toPlatform: 'ios',
        testId: toTestId('login-flow'),
      }),
    ).toThrow(/step 1.*login\.submit/);
  });
});
