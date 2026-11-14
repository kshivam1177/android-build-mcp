/**
 * Scope coverage (Phase 6, B3) — pure logic for the `check-screen-map`
 * ≥80% scope rule.
 *
 * v1 supports apps where ≥80% of interactive elements carry a
 * `resourceId` or a unique `contentDesc`, measured by the
 * check-screen-map report. An element counts as covered when it has a
 * `resourceId`, or a `contentDesc` that is unique within its screen
 * (a duplicated contentDesc identifies nothing on its own).
 */
import type { LearnedScreenElement } from '../domain/types.js';

/** Coverage of one screen (or of all screens pooled). */
export interface ScopeCoverage {
  total: number;
  covered: number;
  /** Percent covered, 0–100, rounded to one decimal. */
  pct: number;
}

/** Count contentDesc occurrences across one screen's elements. */
function contentDescCounts(elements: readonly LearnedScreenElement[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const element of elements) {
    const desc = element.selector.contentDesc;
    if (desc === undefined) continue;
    counts.set(desc, (counts.get(desc) ?? 0) + 1);
  }
  return counts;
}

/**
 * Measure scope coverage of one element set.
 *
 * @param elements - Learned elements of one screen (or pooled screens).
 * @returns Total, covered, and percent covered.
 */
export function stableCoverage(elements: readonly LearnedScreenElement[]): ScopeCoverage {
  const counts = contentDescCounts(elements);
  let covered = 0;
  for (const element of elements) {
    if (element.selector.resourceId !== undefined) {
      covered += 1;
      continue;
    }
    const desc = element.selector.contentDesc;
    if (desc !== undefined && counts.get(desc) === 1) covered += 1;
  }
  const pct = elements.length === 0 ? 100 : Math.round((covered / elements.length) * 1000) / 10;
  return { total: elements.length, covered, pct };
}

/** The v1 scope threshold (B3): at least 80% of elements must be covered. */
export const SCOPE_MIN_PCT = 80;
