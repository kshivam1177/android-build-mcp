/**
 * Scope-coverage tests (Phase 6, B3) — a resourceId always covers, a
 * unique contentDesc covers, a duplicated contentDesc does not, and
 * the 80% threshold is the named constant.
 */
import { describe, expect, it } from 'vitest';
import { SCOPE_MIN_PCT, stableCoverage } from './scope-coverage.js';
import { toElementId } from '../domain/types.js';
import type { LearnedScreenElement } from '../domain/types.js';

/** One learned element with the given selector. */
function element(id: string, selector: Record<string, string>): LearnedScreenElement {
  return { id: toElementId(id), selector, clickable: true, enabled: true };
}

describe('stableCoverage', () => {
  it('covers resourceId elements and unique contentDesc elements', () => {
    const coverage = stableCoverage([
      element('login.submit', { resourceId: 'com.shop.app:id/submit' }),
      element('login.back', { contentDesc: 'Back' }),
      element('login.help', { className: 'android.widget.Button' }),
    ]);
    expect(coverage.total).toBe(3);
    expect(coverage.covered).toBe(2);
    expect(coverage.pct).toBe(66.7);
  });

  it('does not cover a duplicated contentDesc', () => {
    const coverage = stableCoverage([
      element('login.a', { contentDesc: 'Same' }),
      element('login.b', { contentDesc: 'Same' }),
    ]);
    expect(coverage.covered).toBe(0);
    expect(coverage.pct).toBe(0);
  });

  it('reports 100% for an empty set', () => {
    expect(stableCoverage([]).pct).toBe(100);
  });

  it('names the 80% threshold', () => {
    expect(SCOPE_MIN_PCT).toBe(80);
  });
});
