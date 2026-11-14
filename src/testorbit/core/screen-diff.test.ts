import { describe, expect, it } from 'vitest';
import { describeLearnScreenDiff, diffLearnedScreens, isLearnScreenDiffEmpty } from './screen-diff.js';
import type { DiffableElement } from './screen-diff.js';
import { toElementId } from '../domain/types.js';

/** One diffable element with the given id, selector, and state. */
function element(
  id: string,
  resourceId: string,
  clickable = true,
  enabled = true,
): DiffableElement {
  return { id: toElementId(id), selector: { resourceId }, clickable, enabled };
}

describe('diffLearnedScreens — added, removed, renamed', () => {
  it('reports an empty diff for identical sets', () => {
    const old = [element('checkout.pay', 'com.shop.app:id/pay'), element('checkout.back', 'com.shop.app:id/back')];
    const diff = diffLearnedScreens(old, [...old]);
    expect(isLearnScreenDiffEmpty(diff)).toBe(true);
    expect(describeLearnScreenDiff(diff)).toBe('no changes');
  });

  it('reports added and removed elements by stable id', () => {
    const old = [element('checkout.pay', 'com.shop.app:id/pay'), element('checkout.back', 'com.shop.app:id/back')];
    const fresh = [element('checkout.pay', 'com.shop.app:id/pay'), element('checkout.help', 'com.shop.app:id/help')];
    const diff = diffLearnedScreens(old, fresh);
    expect(diff.added).toEqual(['checkout.help']);
    expect(diff.removed).toEqual(['checkout.back']);
    expect(diff.renamed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(describeLearnScreenDiff(diff)).toBe('1 added (checkout.help); 1 removed (checkout.back)');
  });

  it('reports a rename (same selector, different id) instead of add + remove', () => {
    const old = [element('checkout.pay-now', 'com.shop.app:id/pay_now')];
    const fresh = [element('checkout.pay', 'com.shop.app:id/pay_now')];
    const diff = diffLearnedScreens(old, fresh);
    expect(diff.renamed).toEqual([{ from: 'checkout.pay-now', to: 'checkout.pay' }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(describeLearnScreenDiff(diff)).toBe('1 renamed (checkout.pay-now → checkout.pay)');
  });

  it('does not pair a rename when the selectors differ', () => {
    const old = [element('checkout.pay-now', 'com.shop.app:id/pay_now')];
    const fresh = [element('checkout.pay', 'com.shop.app:id/pay')];
    const diff = diffLearnedScreens(old, fresh);
    expect(diff.renamed).toEqual([]);
    expect(diff.added).toEqual(['checkout.pay']);
    expect(diff.removed).toEqual(['checkout.pay-now']);
  });
});

describe('diffLearnedScreens — changed and ordering', () => {

  it('reports clickable/enabled changes on elements present in both sets', () => {
    const old = [element('checkout.pay', 'com.shop.app:id/pay', true, true)];
    const fresh = [element('checkout.pay', 'com.shop.app:id/pay', false, true)];
    const diff = diffLearnedScreens(old, fresh);
    expect(diff.changed).toEqual([{ id: 'checkout.pay', field: 'clickable', learned: true, fresh: false }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(describeLearnScreenDiff(diff)).toBe('1 changed (checkout.pay: clickable true → false)');
  });

  it('reports both fields when clickable and enabled both change', () => {
    const old = [element('checkout.pay', 'com.shop.app:id/pay', true, true)];
    const fresh = [element('checkout.pay', 'com.shop.app:id/pay', false, false)];
    const diff = diffLearnedScreens(old, fresh);
    expect(diff.changed).toHaveLength(2);
    expect(diff.changed.map((entry) => entry.field).sort()).toEqual(['clickable', 'enabled']);
  });

  it('sorts added and removed ids', () => {
    const old = [element('checkout.zeta', 'com.shop.app:id/zeta')];
    const fresh = [element('checkout.beta', 'com.shop.app:id/beta'), element('checkout.alpha', 'com.shop.app:id/alpha')];
    const diff = diffLearnedScreens(old, fresh);
    expect(diff.added).toEqual(['checkout.alpha', 'checkout.beta']);
    expect(diff.removed).toEqual(['checkout.zeta']);
  });
});
