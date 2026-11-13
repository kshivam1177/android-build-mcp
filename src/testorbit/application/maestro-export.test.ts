/**
 * Maestro export tests (C2) — selector mapping, the assertion
 * emission rule in YAML form, and flow building.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMaestroFlow, maestroSelectorFor, variantAssertionCommands } from './maestro-export.js';
import { parseTestCase } from '../domain/testcase-schemas.js';
import { toElementId, toScreenId } from '../domain/types.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import { writeFixtureScreenTree } from '../test-fixtures/variants.js';

describe('maestroSelectorFor', () => {
  it('prefers resourceId, then contentDesc, and fails loudly otherwise', () => {
    expect(maestroSelectorFor({ resourceId: 'com.shop.app:id/pay' }, toElementId('checkout.pay'))).toEqual({
      id: 'com.shop.app:id/pay',
    });
    expect(maestroSelectorFor({ contentDesc: 'Back' }, toElementId('checkout.back'))).toEqual({ text: 'Back' });
    expect(() => maestroSelectorFor({ className: 'android.widget.Button' }, toElementId('checkout.pay'))).toThrow(
      /cannot be mapped to a Maestro selector/,
    );
  });
});

describe('variantAssertionCommands', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-export-'));
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('asserts the unique required element of the variant', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    const commands = variantAssertionCommands(screens, 'login', 'login.password');
    expect(commands).toEqual([{ assertVisible: { id: 'com.shop.app:id/username' } }]);
  });

  it('fails loudly for an unlearned variant', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    expect(() => variantAssertionCommands(screens, 'login', 'login.nope')).toThrow(/no such variant/);
  });
});

describe('buildMaestroFlow', () => {
  it('builds a validated flow with setup and teardown', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-export-'));
    try {
      writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
      const store = new VariantStore(projectRoot, 'android');
      const screens = store.loadAllScreens();
      const testCase = parseTestCase(
        {
          schemaVersion: 2,
          id: 'login-flow',
          goal: 'Log in',
          setup: { clearAppData: true, launchApp: true, disableAnimations: true },
          teardown: { clearAppData: true },
          provenance: { model: 'unknown', promptHash: 'unknown' },
          steps: [
            {
              index: 1,
              screen: 'login',
              variant: 'login.password',
              action: 'tap',
              elementId: 'login.submit',
              timeoutMs: 3000,
              assert: { kind: 'variant-present', variant: 'login.password' },
            },
          ],
        },
        'login-flow.json',
      );
      const flow = buildMaestroFlow(
        testCase,
        screens,
        (elementId) => {
          const element = screens.flatMap((screen) => screen.baseElements).find((item) => item.id === elementId);
          if (element === undefined) throw new Error('missing element');
          return element.selector;
        },
        { appId: 'com.shop.app' },
      );
      expect(flow.config.appId).toBe('com.shop.app');
      expect(flow.config.onFlowComplete).toEqual([{ clearState: null }]);
      expect(flow.commands[0]).toEqual({ launchApp: { clearState: true, appId: 'com.shop.app' } });
      expect(flow.commands).toContainEqual({ tapOn: { id: 'com.shop.app:id/submit' } });
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
