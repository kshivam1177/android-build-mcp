import { describe, expect, it } from 'vitest';
import { findMatchingNode, matchesStableSelector, stableSelectorOf } from './matcher.js';
import type { CoreHierarchyNode, StableSelector } from '../domain/types.js';

function node(overrides: Partial<CoreHierarchyNode> = {}): CoreHierarchyNode {
  const built: CoreHierarchyNode = {
    ref: 'e1',
    bounds: { left: 0, top: 0, right: 100, bottom: 50 },
    clickable: true,
    enabled: true,
  };
  if (overrides.resourceId !== undefined) built.resourceId = overrides.resourceId;
  if (overrides.contentDesc !== undefined) built.contentDesc = overrides.contentDesc;
  if (overrides.className !== undefined) built.className = overrides.className;
  if (overrides.text !== undefined) built.text = overrides.text;
  return built;
}

const PAY_SELECTOR: StableSelector = { resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button' };

describe('matchesStableSelector', () => {
  it('matches when every stored field is equal', () => {
    expect(matchesStableSelector(node({ resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button' }), PAY_SELECTOR)).toBe(true);
  });

  it('ignores text: a price change does not break the match', () => {
    const priced = node({ resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button', text: 'Pay ₹499' });
    const repriced = node({ resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button', text: 'Pay ₹599' });
    expect(matchesStableSelector(priced, PAY_SELECTOR)).toBe(true);
    expect(matchesStableSelector(repriced, PAY_SELECTOR)).toBe(true);
  });

  it('skips a stored field the live node lacks instead of mismatching', () => {
    const selector: StableSelector = { resourceId: 'com.shop.app:id/pay_now', contentDesc: 'Pay now' };
    const withoutDesc = node({ resourceId: 'com.shop.app:id/pay_now' });
    expect(matchesStableSelector(withoutDesc, selector)).toBe(true);
  });

  it('does not match a node carrying none of the stored fields', () => {
    const container = node({ className: 'android.widget.FrameLayout' });
    expect(matchesStableSelector(container, PAY_SELECTOR)).toBe(false);
    expect(matchesStableSelector(node(), PAY_SELECTOR)).toBe(false);
    expect(matchesStableSelector(node({ resourceId: 'com.shop.app:id/pay_now' }), {})).toBe(false);
  });

  it('fails when a field the node carries differs from the stored value', () => {
    expect(matchesStableSelector(node({ resourceId: 'com.shop.app:id/pay_later', className: 'android.widget.Button' }), PAY_SELECTOR)).toBe(false);
    expect(matchesStableSelector(node({ resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.TextView' }), PAY_SELECTOR)).toBe(false);
  });

  it('compares only the fields present in the stored selector', () => {
    const byIdOnly: StableSelector = { resourceId: 'com.shop.app:id/pay_now' };
    const otherClass = node({ resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.TextView' });
    expect(matchesStableSelector(otherClass, byIdOnly)).toBe(true);
  });
});

describe('findMatchingNode', () => {
  it('returns the first matching node and undefined when nothing matches', () => {
    const nodes = [
      node({ resourceId: 'com.shop.app:id/other', className: 'android.widget.Button' }),
      node({ resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button' }),
    ];
    expect(findMatchingNode(nodes, PAY_SELECTOR)?.resourceId).toBe('com.shop.app:id/pay_now');
    expect(findMatchingNode(nodes, { resourceId: 'com.shop.app:id/missing' })).toBeUndefined();
  });
});

describe('stableSelectorOf', () => {
  it('drops text and keeps only the stable fields', () => {
    const selector = stableSelectorOf(node({
      resourceId: 'com.shop.app:id/pay_now',
      contentDesc: 'Pay now',
      className: 'android.widget.Button',
      text: 'Pay ₹499',
    }));
    expect(selector).toEqual({
      resourceId: 'com.shop.app:id/pay_now',
      contentDesc: 'Pay now',
      className: 'android.widget.Button',
    });
  });

  it('omits absent fields', () => {
    expect(stableSelectorOf(node({ className: 'android.widget.Button' }))).toEqual({
      className: 'android.widget.Button',
    });
  });
});
