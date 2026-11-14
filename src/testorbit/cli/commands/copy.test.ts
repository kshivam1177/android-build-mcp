/**
 * `orbit copy` CLI tests — copies a hand-written source test case to
 * iOS and prints the summary; the target YAML is regenerated.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCopyCommand } from './copy.js';
import { toScreenId, toTestId } from '../../domain/types.js';
import { writeFixtureScreenTree } from '../../test-fixtures/variants.js';

/** Minimal iOS login tree (resourceIds differ; contentDesc is shared). */
function writeIosTree(projectRoot: string): void {
  const screenDir = path.join(projectRoot, '.testorbit', 'ios', 'screens', 'login', 'variants');
  fs.mkdirSync(screenDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.testorbit', 'ios', 'screens', 'login', 'screen.json'),
    JSON.stringify({ schemaVersion: 2, screenId: 'login', appPackage: 'com.shop.ios' }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectRoot, '.testorbit', 'ios', 'screens', 'login', 'elements.json'),
    JSON.stringify([
      { id: 'login.submit', stableSelector: { resourceId: 'com.shop.ios:id/submit', contentDesc: 'Log in' }, clickable: true, enabled: true },
      { id: 'login.username', stableSelector: { resourceId: 'com.shop.ios:id/username', contentDesc: 'Username' }, clickable: true, enabled: true },
      { id: 'login.password', stableSelector: { resourceId: 'com.shop.ios:id/password', contentDesc: 'Password' }, clickable: true, enabled: true },
      { id: 'login.help', stableSelector: { resourceId: 'com.shop.ios:id/help', contentDesc: 'Help' }, clickable: true, enabled: true },
    ]),
    'utf8',
  );
  const stamp = `sha256:${'a'.repeat(64)}`;
  fs.writeFileSync(
    path.join(screenDir, 'default.json'),
    JSON.stringify({ schemaVersion: 2, screenId: 'login', variantId: 'default', required: ['login.help'], optional: [], excluded: [], fingerprintStamp: stamp, learnedAt: '2026-11-13T00:00:00.000Z' }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(screenDir, 'login.password.json'),
    JSON.stringify({ schemaVersion: 2, screenId: 'login', variantId: 'login.password', required: ['login.username', 'login.password', 'login.submit'], optional: [], excluded: [], fingerprintStamp: stamp, learnedAt: '2026-11-13T00:00:00.000Z' }),
    'utf8',
  );
}

describe('runCopyCommand', () => {
  let projectRoot: string;
  let output: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-copy-'));
    output = '';
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    const elementsPath = path.join(projectRoot, '.testorbit', 'android', 'screens', 'login', 'elements.json');
    const elements = JSON.parse(fs.readFileSync(elementsPath, 'utf8')) as { id: string; stableSelector: Record<string, string> }[];
    for (const element of elements) {
      if (element.id === 'login.submit') element.stableSelector['contentDesc'] = 'Log in';
    }
    fs.writeFileSync(elementsPath, JSON.stringify(elements, null, 2), 'utf8');
    writeIosTree(projectRoot);
    const testcasesDir = path.join(projectRoot, '.testorbit', 'android', 'testcases');
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
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('copies the test to iOS and prints copied-unverified', async () => {
    const code = await runCopyCommand({
      projectRoot,
      fromPlatform: 'android',
      toPlatform: 'ios',
      testId: toTestId('login-flow'),
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('copied-unverified');
    expect(fs.existsSync(path.join(projectRoot, '.testorbit', 'ios', 'tests', 'login-flow.yaml'))).toBe(true);
  });
});
