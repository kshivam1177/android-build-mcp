/**
 * Recording schema tests (B8) — v1 loads, v2 loads with ids and
 * grounding, v3+ is rejected explicitly, malformed actions fail.
 */
import { describe, expect, it } from 'vitest';
import { parseRecording } from './recording-schemas.js';

/** Minimal v1 recording document (pre-TestOrbit shape). */
function v1Document(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    flowId: 'login-flow',
    deviceId: 'emulator-5554',
    startedAt: '2026-11-13T00:00:00.000Z',
    stoppedAt: '2026-11-13T00:01:00.000Z',
    durationMs: 60000,
    actions: [
      {
        id: 'tap-1',
        type: 'tap',
        timestamp: '2026-11-13T00:00:01.000Z',
        durationMs: 120,
        selector: { resourceId: 'com.shop.app:id/submit' },
      },
    ],
    screenshots: {},
  };
}

describe('parseRecording', () => {
  it('accepts a v1 recording', () => {
    const parsed = parseRecording(v1Document(), 'login-flow.json');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]?.screenId).toBeUndefined();
  });

  it('accepts a v2 recording with screen, variant, element, and grounding', () => {
    const document = v1Document();
    document['schemaVersion'] = 2;
    const actions = document['actions'] as Record<string, unknown>[];
    actions[0] = {
      ...actions[0],
      screenId: 'login',
      variantId: 'login.password',
      elementId: 'login.submit',
      grounding: { method: 'llm-vision', detail: 'hierarchy and OCR found nothing' },
    };
    const parsed = parseRecording(document, 'login-flow.json');
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.actions[0]?.elementId).toBe('login.submit');
    expect(parsed.actions[0]?.grounding?.method).toBe('llm-vision');
  });

  it('rejects v3 explicitly, naming the version', () => {
    const document = v1Document();
    document['schemaVersion'] = 3;
    expect(() => parseRecording(document, 'login-flow.json')).toThrow(/schemaVersion 3/);
  });

  it('rejects an empty action list and an unknown action type', () => {
    const empty = v1Document();
    empty['actions'] = [];
    expect(() => parseRecording(empty, 'x.json')).toThrow(/actions/);
    const badType = v1Document();
    (badType['actions'] as Record<string, unknown>[])[0] = {
      id: 'x-1',
      type: 'drag',
      timestamp: '2026-11-13T00:00:01.000Z',
      durationMs: 1,
    };
    expect(() => parseRecording(badType, 'x.json')).toThrow(/type/);
  });
});
