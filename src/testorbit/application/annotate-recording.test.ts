/**
 * Post-pass annotator tests (B7) — v1 actions are filled by
 * selector-matching, v2 actions pass through, and no/ambiguous matches
 * fail loudly naming the action. Fixture hierarchies only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { annotateRecording } from './annotate-recording.js';
import type { TestOrbitRecordingDocument } from '../domain/recording-schemas.js';
import { toElementId } from '../domain/types.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import { toScreenId } from '../domain/types.js';
import { writeFixtureScreenTree } from '../test-fixtures/variants.js';

/** A v1 recording document from raw action rows. */
function recording(actions: Record<string, unknown>[]): TestOrbitRecordingDocument {
  return {
    schemaVersion: 1,
    flowId: 'login-flow',
    deviceId: 'emulator-5554',
    startedAt: '2026-11-13T00:00:00.000Z',
    stoppedAt: '2026-11-13T00:01:00.000Z',
    durationMs: 1000,
    actions: actions.map((action, position) => ({
      id: `action-${position + 1}`,
      type: 'tap',
      timestamp: '2026-11-13T00:00:01.000Z',
      durationMs: 1,
      ...action,
    })) as TestOrbitRecordingDocument['actions'],
    screenshots: {},
  };
}

/** Temp project with login + checkout learned. */
function makeProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-annotate-'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
  return projectRoot;
}

describe('annotateRecording — selector resolution', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fills screen, variant, and element for a v1 tap by selector', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    const annotated = annotateRecording(
      recording([{ selector: { resourceId: 'com.shop.app:id/username' } }]),
      screens,
    );
    expect(annotated[0]?.screenId).toBe('login');
    expect(annotated[0]?.variantId).toBe('login.password');
    expect(annotated[0]?.elementId).toBe('login.username');
  });

  it('passes a v2 action with screen, variant, and element through', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    const document = recording([{ selector: { resourceId: 'com.shop.app:id/submit' } }]);
    document.schemaVersion = 2;
    const first = document.actions[0];
    if (first === undefined) throw new Error('fixture recording has no actions');
    document.actions[0] = {
      ...first,
      screenId: 'login',
      variantId: 'login.password',
      elementId: 'login.submit',
    };
    const annotated = annotateRecording(document, screens);
    expect(annotated[0]?.elementId).toBe('login.submit');
  });

  it('fails loudly on an unmappable selector, naming the action', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    expect(() =>
      annotateRecording(recording([{ selector: { resourceId: 'com.shop.app:id/nope' } }]), screens),
    ).toThrow(/action-1/);
  });

  it('fails loudly on an ambiguous className-only selector', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    expect(() =>
      annotateRecording(recording([{ selector: { className: 'android.widget.Button' } }]), screens),
    ).toThrow(/matches \d+ elements/);
  });
});

describe('annotateRecording — overrides and key fallback', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('applies a host-agent LLM-vision override and marks groundedBy', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    const annotated = annotateRecording(
      recording([{ selector: { resourceId: 'com.shop.app:id/unknown' } }]),
      screens,
      [{ actionId: 'action-1', elementId: toElementId('login.submit'), method: 'llm-vision' }],
    );
    expect(annotated[0]?.elementId).toBe('login.submit');
    expect(annotated[0]?.groundedBy).toBe('llm-vision');
  });

  it('inherits the screen for a key press and fails on a leading key press', () => {
    const screens = new VariantStore(projectRoot, 'android').loadAllScreens();
    const withTap = annotateRecording(
      recording([
        { selector: { resourceId: 'com.shop.app:id/submit' } },
        { type: 'key_press', keyCode: 'KEYCODE_BACK' },
      ]),
      screens,
    );
    expect(withTap[1]?.screenId).toBe('login');
    expect(withTap[1]?.elementId).toBeNull();
    expect(() =>
      annotateRecording(recording([{ type: 'key_press', keyCode: 'KEYCODE_BACK' }]), screens),
    ).toThrow(/first action/);
  });
});
