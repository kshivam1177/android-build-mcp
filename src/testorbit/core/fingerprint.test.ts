import { describe, expect, it } from 'vitest';
import {
  computeFingerprintStamp,
  describeFingerprintDiff,
  matchFingerprint,
} from './fingerprint.js';
import type { FingerprintMatchResult, LearnedFingerprintElement } from './fingerprint.js';
import { toElementId } from '../domain/types.js';
import type { CoreHierarchyNode } from '../domain/types.js';

const DISPLAY = { width: 1080, height: 2400 };
const ON_SCREEN = { left: 10, top: 20, right: 110, bottom: 70 };
const OFF_SCREEN = { left: 10, top: 2500, right: 110, bottom: 2600 };

const LEARNED_IDS = [
  ['checkout.pay-now', 'com.shop.app:id/pay_now'],
  ['checkout.card-number', 'com.shop.app:id/card_number'],
  ['checkout.expiry', 'com.shop.app:id/expiry'],
  ['checkout.cvv', 'com.shop.app:id/cvv'],
  ['checkout.save-card', 'com.shop.app:id/save_card'],
  ['checkout.promo-banner', 'com.shop.app:id/promo_banner'],
  ['checkout.help', 'com.shop.app:id/help'],
  ['checkout.back', 'com.shop.app:id/back'],
  ['checkout.apply-coupon', 'com.shop.app:id/apply_coupon'],
  ['checkout.terms', 'com.shop.app:id/terms'],
] as const;

function learnedElement(
  id: string,
  resourceId: string,
  overrides: Partial<LearnedFingerprintElement> = {},
): LearnedFingerprintElement {
  const element: LearnedFingerprintElement = {
    id: toElementId(id),
    selector: { resourceId },
    clickable: true,
    enabled: true,
  };
  if (overrides.selector !== undefined) element.selector = overrides.selector;
  if (overrides.clickable !== undefined) element.clickable = overrides.clickable;
  if (overrides.enabled !== undefined) element.enabled = overrides.enabled;
  if (overrides.text !== undefined) element.text = overrides.text;
  if (overrides.bounds !== undefined) element.bounds = overrides.bounds;
  return element;
}

function freshNode(ref: string, resourceId: string, overrides: Partial<CoreHierarchyNode> = {}): CoreHierarchyNode {
  const node: CoreHierarchyNode = {
    ref,
    resourceId,
    bounds: ON_SCREEN,
    clickable: true,
    enabled: true,
  };
  if (overrides.text !== undefined) node.text = overrides.text;
  if (overrides.bounds !== undefined) node.bounds = overrides.bounds;
  if (overrides.clickable !== undefined) node.clickable = overrides.clickable;
  if (overrides.enabled !== undefined) node.enabled = overrides.enabled;
  if (overrides.packageName !== undefined) node.packageName = overrides.packageName;
  if (overrides.className !== undefined) node.className = overrides.className;
  return node;
}

function learnedSet(): LearnedFingerprintElement[] {
  return LEARNED_IDS.map(([id, rid]) => learnedElement(id, rid));
}

function freshSet(): CoreHierarchyNode[] {
  return LEARNED_IDS.map(([, rid], index) => freshNode(`e${index + 1}`, rid));
}

function check(
  learned: LearnedFingerprintElement[],
  fresh: CoreHierarchyNode[],
  required: string[] = [],
  excluded: LearnedFingerprintElement[] = [],
): FingerprintMatchResult {
  return matchFingerprint({
    learned,
    required: required.map(toElementId),
    excluded,
    fresh,
    display: DISPLAY,
  });
}

describe('matchFingerprint — passing screens', () => {
  it('passes when the fresh dump equals the learned set', () => {
    const result = check(learnedSet(), freshSet(), ['checkout.pay-now']);
    expect(result.matched).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it('passes on a value-only change and warns about the text', () => {
    const learned = learnedSet();
    const pay = learned[0] as LearnedFingerprintElement;
    pay.text = 'Pay ₹499';
    const fresh = freshSet();
    (fresh[0] as CoreHierarchyNode).text = 'Pay ₹599';
    const result = check(learned, fresh, ['checkout.pay-now']);
    expect(result.matched).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('checkout.pay-now'))).toBe(true);
  });

  it('passes on bounds movement and warns about it', () => {
    const learned = learnedSet();
    (learned[0] as LearnedFingerprintElement).bounds = ON_SCREEN;
    const fresh = freshSet();
    (fresh[0] as CoreHierarchyNode).bounds = { left: 20, top: 30, right: 120, bottom: 80 };
    const result = check(learned, fresh, ['checkout.pay-now']);
    expect(result.matched).toBe(true);
    expect(result.warnings).toContain('bounds moved on checkout.pay-now');
  });

  it('ignores a system-chrome node in the fresh dump', () => {
    const fresh = [...freshSet(), freshNode('e99', 'com.android.systemui:id/status_bar', { packageName: 'com.android.systemui' })];
    const result = check(learnedSet(), fresh);
    expect(result.matched).toBe(true);
    expect(result.added).toEqual([]);
  });
});

describe('matchFingerprint — the 10% drift budget', () => {
  it('passes at exactly floor(0.10 x n) drift and fails one more over', () => {
    const oneMissing = check(learnedSet(), freshSet().slice(1));
    expect(oneMissing.matched).toBe(true);
    expect(oneMissing.budget).toEqual({ nonRequiredCount: 10, allowedDrift: 1, usedDrift: 1 });
    const twoMissing = check(learnedSet(), freshSet().slice(2));
    expect(twoMissing.matched).toBe(false);
    expect(twoMissing.budget.usedDrift).toBe(2);
  });

  it('tolerates zero drift on a 5-element variant', () => {
    const learned = learnedSet().slice(0, 5);
    const oneMissing = check(learned, freshSet().slice(0, 5).slice(1));
    expect(oneMissing.budget).toEqual({ nonRequiredCount: 5, allowedDrift: 0, usedDrift: 1 });
    expect(oneMissing.matched).toBe(false);
  });

  it('counts an added element against the same budget', () => {
    const fresh = [...freshSet(), freshNode('e99', 'com.shop.app:id/surprise_offer')];
    const oneAdded = check(learnedSet(), fresh);
    expect(oneAdded.matched).toBe(true);
    expect(oneAdded.added).toHaveLength(1);
    const twoAdded = check(learnedSet(), [...fresh, freshNode('e100', 'com.shop.app:id/other_offer')]);
    expect(twoAdded.matched).toBe(false);
    expect(twoAdded.budget.usedDrift).toBe(2);
  });
});

describe('matchFingerprint — failures name the element', () => {
  it('fails naming the missing required element when a button is removed', () => {
    const result = check(learnedSet(), freshSet().slice(1), ['checkout.pay-now']);
    expect(result.matched).toBe(false);
    expect(result.missingRequired).toEqual(['checkout.pay-now']);
    expect(describeFingerprintDiff(result)).toContain('checkout.pay-now');
  });

  it('fails when a required id is not in the learned set at all', () => {
    const result = check(learnedSet(), freshSet(), ['checkout.not-learned']);
    expect(result.matched).toBe(false);
    expect(result.missingRequired).toContain('checkout.not-learned');
  });

  it('treats an off-screen required element as missing', () => {
    const fresh = freshSet();
    (fresh[0] as CoreHierarchyNode).bounds = OFF_SCREEN;
    const result = check(learnedSet(), fresh, ['checkout.pay-now']);
    expect(result.matched).toBe(false);
    expect(result.missingRequired).toEqual(['checkout.pay-now']);
  });

  it('fails clause (i) when a required element is changed-disabled', () => {
    const fresh = freshSet();
    (fresh[0] as CoreHierarchyNode).enabled = false;
    const result = check(learnedSet(), fresh, ['checkout.pay-now']);
    expect(result.matched).toBe(false);
    expect(result.changedRequired).toEqual([
      { id: 'checkout.pay-now', field: 'enabled', learned: true, fresh: false },
    ]);
  });

  it('warns only when a non-required element changes', () => {
    const fresh = freshSet();
    (fresh[4] as CoreHierarchyNode).enabled = false;
    const result = check(learnedSet(), fresh, ['checkout.pay-now']);
    expect(result.matched).toBe(true);
    expect(result.changedNonRequired).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('checkout.save-card'))).toBe(true);
  });

  it('fails when an excluded element is present, passes when it is absent', () => {
    const excluded = [learnedElement('checkout.upi-id', 'com.shop.app:id/upi_id')];
    const absent = check(learnedSet(), freshSet(), [], excluded);
    expect(absent.matched).toBe(true);
    const fresh = [...freshSet(), freshNode('e99', 'com.shop.app:id/upi_id')];
    const present = check(learnedSet(), fresh, [], excluded);
    expect(present.matched).toBe(false);
    expect(present.excludedPresent).toEqual(['checkout.upi-id']);
    expect(present.added).toEqual([]);
  });
});

describe('computeFingerprintStamp', () => {
  it('is deterministic and order-independent, and changes when a selector changes', () => {
    const selectors = learnedSet().map((element) => element.selector);
    const stamp = computeFingerprintStamp(selectors);
    expect(computeFingerprintStamp([...selectors].reverse())).toBe(stamp);
    expect(computeFingerprintStamp(selectors)).toBe(stamp);
    const changed = [...selectors, { resourceId: 'com.shop.app:id/extra' }];
    expect(computeFingerprintStamp(changed)).not.toBe(stamp);
  });
});
