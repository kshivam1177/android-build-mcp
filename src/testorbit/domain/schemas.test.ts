import { describe, expect, it } from 'vitest';
import { LearnScreenDiffSchema, parseDetectionResult, parseScreenElements, parseVariantDefinition } from './schemas.js';
import { SchemaVersionError } from './errors.js';

const VARIANT = {
  schemaVersion: 2,
  screenId: 'checkout',
  variantId: 'checkout.online-card',
  required: ['checkout.card-number', 'checkout.expiry', 'checkout.pay'],
  optional: ['checkout.save-card'],
  excluded: ['checkout.upi-id', 'checkout.cod-confirm'],
  fingerprintStamp: `sha256:${'a'.repeat(64)}`,
  learnedAt: '2026-11-13T10:00:00Z',
  learnedFrom: 'recording: checkout-card-flow-2026-11-13.json',
};

describe('parseVariantDefinition', () => {
  it('parses a valid variant file and brands its ids', () => {
    const definition = parseVariantDefinition(VARIANT, 'variants/checkout.online-card.json');
    expect(definition.screenId).toBe('checkout');
    expect(definition.variantId).toBe('checkout.online-card');
    expect(definition.required).toEqual(['checkout.card-number', 'checkout.expiry', 'checkout.pay']);
    expect(definition.optional).toEqual(['checkout.save-card']);
    expect(definition.excluded).toEqual(['checkout.upi-id', 'checkout.cod-confirm']);
    expect(definition.learnedFrom).toBe('recording: checkout-card-flow-2026-11-13.json');
  });

  it('rejects a default variant with an empty required set', () => {
    expect(() => parseVariantDefinition({ ...VARIANT, required: [] }, 'variants/default.json')).toThrow(
      SchemaVersionError,
    );
  });

  it('rejects a stamp without the sha256: prefix', () => {
    expect(() =>
      parseVariantDefinition({ ...VARIANT, fingerprintStamp: 'a'.repeat(64) }, 'variants/bad.json'),
    ).toThrow(SchemaVersionError);
  });

  it('rejects schemaVersion 1', () => {
    expect(() => parseVariantDefinition({ ...VARIANT, schemaVersion: 1 }, 'variants/old.json')).toThrow(
      SchemaVersionError,
    );
  });

  it('names the failing field in the error', () => {
    expect(() => parseVariantDefinition({ ...VARIANT, required: 'nope' }, 'variants/bad.json')).toThrow(
      /required/,
    );
  });
});

describe('parseScreenElements', () => {
  it('parses base elements with stable selectors only', () => {
    const elements = parseScreenElements(
      [
        { id: 'checkout.pay', stableSelector: { resourceId: 'com.shop.app:id/pay_now' }, clickable: true, enabled: true },
        { id: 'checkout.card-number', stableSelector: { resourceId: 'com.shop.app:id/card_number' }, clickable: true, enabled: true, text: '4111' },
      ],
      'elements.json',
    );
    expect(elements).toHaveLength(2);
    expect(elements[0]?.selector).toEqual({ resourceId: 'com.shop.app:id/pay_now' });
    expect(elements[1]?.text).toBe('4111');
  });

  it('rejects an element missing its stable selector', () => {
    expect(() =>
      parseScreenElements([{ id: 'checkout.pay', clickable: true, enabled: true }], 'elements.json'),
    ).toThrow(SchemaVersionError);
  });
});

describe('parseDetectionResult', () => {
  it('parses a matched result with its fingerprint evidence', () => {
    const result = parseDetectionResult({
      kind: 'matched',
      screenId: 'checkout',
      variantId: 'checkout.online-card',
      evidence: {
        matched: true,
        missingRequired: [],
        missingNonRequired: [],
        added: [],
        changedRequired: [],
        changedNonRequired: [],
        excludedPresent: [],
        warnings: [],
        budget: { nonRequiredCount: 5, allowedDrift: 0, usedDrift: 0 },
      },
    });
    expect(result.kind).toBe('matched');
  });

  it('parses an unknown result with a null screen id', () => {
    const result = parseDetectionResult({ kind: 'unknown', screenId: null, checked: ['a', 'b'], evidence: 'none' });
    expect(result.kind).toBe('unknown');
  });

  it('rejects an unknown kind', () => {
    expect(() => parseDetectionResult({ kind: 'maybe' })).toThrow(SchemaVersionError);
  });
});

describe('LearnScreenDiffSchema', () => {
  it('accepts a diff with added, removed, renamed, and changed entries', () => {
    const parsed = LearnScreenDiffSchema.safeParse({
      added: ['checkout.help'],
      removed: ['checkout.back'],
      renamed: [{ from: 'checkout.pay-now', to: 'checkout.pay' }],
      changed: [{ id: 'checkout.pay', field: 'clickable', learned: true, fresh: false }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a changed entry with an unknown field', () => {
    const parsed = LearnScreenDiffSchema.safeParse({
      added: [],
      removed: [],
      renamed: [],
      changed: [{ id: 'checkout.pay', field: 'text', learned: true, fresh: false }],
    });
    expect(parsed.success).toBe(false);
  });
});
