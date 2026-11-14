/**
 * Canonical test-case schema tests (C1) — the v2 shape parses, the
 * assert kinds and payload shapes are enforced, and unknown versions
 * are rejected.
 */
import { describe, expect, it } from 'vitest';
import { RunReportSchema, parseTestCase } from './testcase-schemas.js';

/** Minimal valid canonical test case (C1 shape). */
function validTestCase(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: 'checkout-cod',
    goal: 'Complete checkout with Cash on Delivery',
    setup: { clearAppData: true, launchApp: true, disableAnimations: true },
    teardown: { clearAppData: true },
    provenance: { model: 'unknown', promptHash: 'unknown' },
    steps: [
      {
        index: 1,
        screen: 'checkout',
        variant: 'checkout.method-picker',
        action: 'tap',
        elementId: 'checkout.cod-option',
        timeoutMs: 3000,
        assert: { kind: 'variant-present', variant: 'checkout.cod' },
      },
    ],
  };
}

/** A valid test case with one step carrying the given assert. */
function validCaseWithAssert(assert: Record<string, unknown>): Record<string, unknown> {
  const document = validTestCase();
  (document['steps'] as Record<string, unknown>[])[0] = {
    index: 1,
    screen: 'checkout',
    variant: 'checkout.cod',
    action: 'tap',
    elementId: 'checkout.cod-confirm',
    timeoutMs: 3000,
    assert,
  };
  return document;
}

describe('run report schema', () => {
  /** Minimal valid run report (Phase 9 standard format). */
  function validReport(): Record<string, unknown> {
    return {
      schemaVersion: 2,
      testId: 'login-flow',
      platform: 'android',
      startedAt: '2026-11-13T00:00:00.000Z',
      durationMs: 1000,
      success: true,
      llmCalls: { plan: 1, record: 2, replay: 0 },
      steps: [{ index: 1, command: 'tapOn', status: 'passed', durationMs: 120 }],
    };
  }

  it('parses without a coverage block (no map generated yet)', () => {
    expect(RunReportSchema.safeParse(validReport()).success).toBe(true);
  });

  it('parses with the map coverage block from screen-map.json', () => {
    const report = validReport();
    report['coverage'] = {
      screensLearned: 2,
      variantsLearned: 3,
      edgeCount: 1,
      screensNeverTraversed: ['settings'],
      variantsNeverTraversed: ['settings.default'],
    };
    const parsed = RunReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.coverage?.screensLearned).toBe(2);
  });

  it('rejects a non-zero replay LLM count', () => {
    const report = validReport();
    (report['llmCalls'] as Record<string, unknown>)['replay'] = 1;
    expect(RunReportSchema.safeParse(report).success).toBe(false);
  });
});

describe('parseTestCase', () => {
  it('accepts a valid v2 test case', () => {
    const parsed = parseTestCase(validTestCase(), 'checkout-cod.json');
    expect(parsed.id).toBe('checkout-cod');
    expect(parsed.steps).toHaveLength(1);
  });

  it('accepts every assert kind with its payload shape', () => {
    const document = validTestCase();
    const steps = document['steps'] as Record<string, unknown>[];
    steps[0] = {
      ...steps[0],
      assert: { kind: 'visible', target: { id: 'checkout.cod-confirm' } },
    };
    expect(parseTestCase(document, 'x.json').steps[0]?.assert.kind).toBe('visible');
    const contains = validCaseWithAssert({ kind: 'contains', text: 'Order placed' });
    expect(parseTestCase(contains, 'x.json').steps[0]?.assert.kind).toBe('contains');
  });

  it('rejects schemaVersion 1 and a missing setup', () => {
    const old = validTestCase();
    old['schemaVersion'] = 1;
    expect(() => parseTestCase(old, 'x.json')).toThrow(/schemaVersion/);
    const noSetup = validTestCase();
    delete noSetup['setup'];
    expect(() => parseTestCase(noSetup, 'x.json')).toThrow(/setup/);
  });

  it('rejects an unknown assert kind', () => {
    const document = validTestCase();
    (document['steps'] as Record<string, unknown>[])[0] = {
      ...(document['steps'] as Record<string, unknown>[])[0],
      assert: { kind: 'enabled' },
    };
    expect(() => parseTestCase(document, 'x.json')).toThrow(/assert/);
  });

  it('accepts a copied test marked copied-unverified with provenance', () => {
    const document = validTestCase();
    document['verificationStatus'] = 'copied-unverified';
    (document['provenance'] as Record<string, unknown>)['copiedFrom'] = {
      platform: 'android',
      testId: 'checkout-cod',
    };
    const parsed = parseTestCase(document, 'x.json');
    expect(parsed.verificationStatus).toBe('copied-unverified');
    expect(parsed.provenance.copiedFrom?.testId).toBe('checkout-cod');
  });
});
