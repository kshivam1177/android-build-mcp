/**
 * Converter tests (C2) — a v1 fixture recording becomes a canonical
 * JSON test case + validated Maestro YAML: env-var refs replace typed
 * values (a password grep finds nothing literal), the submit element
 * lands in form-spec.json, loading pairs and the mapping table hold,
 * and unmappable actions fail loudly. Fixture data only — no flows
 * are shipped as example tests.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConvertRecordingUseCase } from './convert-recording.js';
import { parseMaestroYaml } from '../domain/maestro-schema.js';
import type { TestOrbitRecordingDocument } from '../domain/recording-schemas.js';
import { parseTestCase } from '../domain/testcase-schemas.js';
import { toElementId, toScreenId, toTestId } from '../domain/types.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import { writeFixtureScreenTree } from '../test-fixtures/variants.js';

/** Fixture-only typed value used to prove redaction (not a real secret). */
const FIXTURE_PASSWORD = 's3cret-pw-value-fixture';

/** Build a v1 recording document from raw action rows. */
function recording(actions: Record<string, unknown>[]): TestOrbitRecordingDocument {
  return {
    schemaVersion: 1,
    flowId: 'login-checkout-flow',
    deviceId: 'emulator-5554',
    startedAt: '2026-11-13T00:00:00.000Z',
    stoppedAt: '2026-11-13T00:01:00.000Z',
    durationMs: 1000,
    actions: actions.map((action, position) => ({
      id: `action-${position + 1}`,
      type: 'tap',
      timestamp: '2026-11-13T00:00:01.000Z',
      durationMs: 100,
      ...action,
    })) as TestOrbitRecordingDocument['actions'],
    screenshots: {},
  };
}

/** The login → checkout fixture flow: tap, type password, submit, pick COD. */
function loginCheckoutRecording(): TestOrbitRecordingDocument {
  return recording([
    { selector: { resourceId: 'com.shop.app:id/username' } },
    {
      type: 'type_text',
      selector: { resourceId: 'com.shop.app:id/password' },
      text: FIXTURE_PASSWORD,
    },
    { selector: { resourceId: 'com.shop.app:id/submit' } },
    { selector: { resourceId: 'com.shop.app:id/cod_option' } },
  ]);
}

/** Temp project with login + checkout learned and a login form-spec. */
function makeProject(): { projectRoot: string; useCase: ConvertRecordingUseCase } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-convert-'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
  const loginDir = path.join(projectRoot, '.testorbit', 'android', 'screens', 'login');
  fs.writeFileSync(
    path.join(loginDir, 'form-spec.json'),
    JSON.stringify({ fields: [{ elementId: 'login.password' }], submitButton: null }, null, 2),
    'utf8',
  );
  return { projectRoot, useCase: new ConvertRecordingUseCase(new VariantStore(projectRoot, 'android')) };
}

/** Convert a document in a fixture project. */
function convertIn(
  projectRoot: string,
  useCase: ConvertRecordingUseCase,
  document: TestOrbitRecordingDocument,
  extra: Record<string, unknown> = {},
) {
  return useCase.convert({
    projectRoot,
    platform: 'android',
    recording: document,
    testId: toTestId('login-checkout-flow'),
    goal: 'Log in and pick Cash on Delivery',
    appId: 'com.shop.app',
    ...extra,
  });
}

/** Shared fixture project for every test in this file. */
let projectRoot: string;
let useCase: ConvertRecordingUseCase;

beforeEach(() => {
  ({ projectRoot, useCase } = makeProject());
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

/** Convert a document in the shared fixture project. */
function convert(document: TestOrbitRecordingDocument, extra: Record<string, unknown> = {}) {
  return convertIn(projectRoot, useCase, document, extra);
}

/** Assert the JSON shape, YAML commands, and secret-freedom of a conversion. */
function assertConvertedOutput(
  result: ReturnType<ConvertRecordingUseCase['convert']>,
  savedJson: string,
  envExample: string,
): void {
  expect(result.testCase.steps[1]?.text).toBe('${TEST_LOGIN_PASSWORD}');
  expect(result.envVars).toEqual(['TEST_LOGIN_PASSWORD']);
  expect(result.submitElementId).toBe('login.submit');
  const formSpec = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, '.testorbit', 'android', 'screens', 'login', 'form-spec.json'),
      'utf8',
    ),
  ) as { submitButton: string | null };
  expect(formSpec.submitButton).toBe('login.submit');
  expect(envExample).toContain('TEST_LOGIN_PASSWORD=');
  expect(parseTestCase(JSON.parse(savedJson) as unknown, result.testCasePath).id).toBe('login-checkout-flow');
  const flow = parseMaestroYaml(result.yamlText);
  expect(flow.commands).toContainEqual({ tapOn: { id: 'com.shop.app:id/submit' } });
  expect(flow.commands).toContainEqual({ inputText: '${TEST_LOGIN_PASSWORD}' });
  expect(flow.commands).toContainEqual({ assertVisible: { id: 'com.shop.app:id/username' } });
  for (const output of [result.yamlText, savedJson, envExample]) {
    expect(output).not.toContain(FIXTURE_PASSWORD);
  }
}

describe('ConvertRecordingUseCase — JSON + YAML output', () => {
  it('converts a v1 recording to JSON + YAML with env refs, never literals', () => {
    const result = convert(loginCheckoutRecording());
    expect(result.testCase.steps).toHaveLength(4);
    expect(result.testCase.steps[0]?.screen).toBe('login');
    expect(result.testCase.steps[0]?.variant).toBe('login.password');
    expect(result.testCase.steps[3]?.screen).toBe('checkout');
    expect(result.testCase.steps[3]?.variant).toBe('checkout.method-picker');
    assertConvertedOutput(result, fs.readFileSync(result.testCasePath, 'utf8'), fs.readFileSync(result.envExamplePath, 'utf8'));
  });

  it('emits the loading pair before a navigation step when an indicator is known', () => {
    const result = convert(loginCheckoutRecording(), {
      loadingIndicators: { checkout: { text: 'Loading…' } },
    });
    const commands = parseMaestroYaml(result.yamlText).commands;
    const notVisibleAt = commands.findIndex((command) => 'assertNotVisible' in command);
    const codTapAt = commands.findIndex(
      (command) => 'tapOn' in command && JSON.stringify(command).includes('cod_option'),
    );
    expect(notVisibleAt).toBeGreaterThan(-1);
    expect(notVisibleAt).toBeLessThan(codTapAt);
    expect(commands[notVisibleAt]).toEqual({ assertNotVisible: { text: 'Loading…' } });
    expect(commands[notVisibleAt + 1]).toEqual({ assertVisible: { id: 'com.shop.app:id/cod_option' } });
  });

});

describe('ConvertRecordingUseCase — mapping table and failures', () => {
  it('maps long_press, swipe, and key_press per the C2 table', () => {
    const result = convert(
      recording([
        { type: 'long_press', selector: { resourceId: 'com.shop.app:id/submit' }, durationMs: 800 },
        {
          type: 'swipe',
          selector: { resourceId: 'com.shop.app:id/submit' },
          normalizedSwipe: { startX: 0.5, startY: 0.8, endX: 0.5, endY: 0.2 },
          durationMs: 400,
        },
        { type: 'key_press', keyCode: 'KEYCODE_BACK' },
      ]),
    );
    const commands = parseMaestroYaml(result.yamlText).commands;
    expect(commands).toContainEqual({ longPressOn: { id: 'com.shop.app:id/submit' } });
    expect(commands).toContainEqual({ swipe: { direction: 'UP', duration: 400 } });
    expect(commands).toContainEqual({ pressKey: 'BACK' });
  });

  it('fails loudly on an unmappable element, naming the action', () => {
    expect(() =>
      convert(recording([{ selector: { resourceId: 'com.shop.app:id/nope' } }])),
    ).toThrow(/action-1/);
  });

  it('records an LLM-vision grounding override with provenance', () => {
    const result = convert(recording([{ selector: { resourceId: 'com.shop.app:id/unknown' } }]), {
      groundingOverrides: [
        { actionId: 'action-1', elementId: toElementId('login.submit'), method: 'llm-vision' as const },
      ],
    });
    expect(result.testCase.steps[0]?.elementId).toBe('login.submit');
    expect(result.testCase.steps[0]?.groundedBy).toBe('llm-vision');
  });

  it('reports no submit element when the flow never navigates', () => {
    const result = convert(
      recording([{ selector: { resourceId: 'com.shop.app:id/username' } }]),
    );
    expect(result.submitElementId).toBeNull();
  });
});
