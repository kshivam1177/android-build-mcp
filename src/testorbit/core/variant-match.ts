/**
 * Variant detection + screen identification (Part B, B7) — the ONE match
 * rule, used everywhere.
 *
 * Within a screen, variants are checked most-specific first (required
 * count desc, then excluded count desc, then alphabetical variant id),
 * `default` last; a combined check runs before the per-variant loop.
 * Across screens, every learned (screen, variant) is scored with the full
 * B4 rule and only passing candidates are ranked; a tie fails naming the
 * candidates. Below threshold the result is `unknown` with evidence —
 * never a silent guess.
 *
 * Pure logic, no I/O. All matching goes through `matchFingerprint` (B4).
 */
import { matchFingerprint } from './fingerprint.js';
import type { FingerprintCheckInput, FingerprintMatchResult, LearnedFingerprintElement } from './fingerprint.js';
import { findPresentNode } from './screen-identity.js';
import type { DisplaySize } from './screen-identity.js';
import { toVariantId } from '../domain/types.js';
import type { CoreHierarchyNode, ElementId, ScreenId, VariantId } from '../domain/types.js';

/** The variant id every screen's fallback variant carries (B2). */
export const DEFAULT_VARIANT_ID: VariantId = toVariantId('default');

/** One learned (screen, variant) candidate for matching. */
export interface VariantCandidate {
  screenId: ScreenId;
  variantId: VariantId;
  required: readonly ElementId[];
  optional: readonly ElementId[];
  excluded: readonly ElementId[];
  /** Base ∪ variant learned elements: selectors for every referenced id. */
  elements: readonly LearnedFingerprintElement[];
  /**
   * Selectors for the excluded ids, kept separate from `elements`: an
   * excluded element is absent by definition, so it must never count
   * toward the B4 drift budget over the learned set.
   */
  excludedElements: readonly LearnedFingerprintElement[];
}

/** One candidate plus the full B4 result of checking it. */
export interface CandidateMatch {
  candidate: VariantCandidate;
  fingerprint: FingerprintMatchResult;
}

/** Within-screen detection outcome (B7). */
export type VariantDetectionResult =
  | { kind: 'matched'; screenId: ScreenId; variantId: VariantId; evidence: FingerprintMatchResult }
  | { kind: 'unknown'; screenId: ScreenId; checked: readonly VariantId[]; evidence: readonly CandidateMatch[] }
  | { kind: 'ambiguous'; screenId: ScreenId; candidates: readonly VariantId[]; reason: string };

/** Across-screen identification outcome (B7). */
export type ScreenIdentificationResult =
  | { kind: 'matched'; screenId: ScreenId; variantId: VariantId; evidence: FingerprintMatchResult }
  | { kind: 'unknown'; screenId: null; checked: readonly string[]; evidence: readonly CandidateMatch[] }
  | { kind: 'ambiguous'; screenId: null; candidates: readonly string[]; reason: string };

/** Map of element id to its learned element for one candidate. */
function elementsById(candidate: VariantCandidate): ReadonlyMap<ElementId, LearnedFingerprintElement> {
  return new Map(candidate.elements.map((element) => [element.id, element]));
}

/** Build the B4 fingerprint input for one candidate. */
function fingerprintInput(
  candidate: VariantCandidate,
  fresh: readonly CoreHierarchyNode[],
  display: DisplaySize,
): FingerprintCheckInput {
  return { learned: candidate.elements, required: candidate.required, excluded: candidate.excludedElements, fresh, display };
}

/** Run the full B4 rule for one candidate. */
function checkCandidate(
  candidate: VariantCandidate,
  fresh: readonly CoreHierarchyNode[],
  display: DisplaySize,
): CandidateMatch {
  return { candidate, fingerprint: matchFingerprint(fingerprintInput(candidate, fresh, display)) };
}

/** Whether two id sets contain exactly the same ids. */
function sameIdSet(left: readonly ElementId[], right: readonly ElementId[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

/**
 * Whether every required element of a candidate is present in the fresh
 * dump and not changed-disabled (B4 clause (i) / B6 present rule).
 */
function requiredFullyPresent(
  candidate: VariantCandidate,
  fresh: readonly CoreHierarchyNode[],
  display: DisplaySize,
): boolean {
  const byId = elementsById(candidate);
  for (const id of candidate.required) {
    const element = byId.get(id);
    if (element === undefined) return false;
    const node = findPresentNode(fresh, element.selector, display);
    if (node === undefined) return false;
    if (node.clickable !== element.clickable || node.enabled !== element.enabled) return false;
  }
  return true;
}

type CombinedOutcome =
  | { kind: 'combined'; candidate: VariantCandidate; evidence: FingerprintMatchResult }
  | { kind: 'conflict'; first: VariantId; second: VariantId }
  | { kind: 'none' };

/**
 * Combined check (B2, B7), before the per-variant loop: if two variants'
 * required sets are both fully present, the combined variant matches when
 * its file exists — otherwise the result is a conflict naming both
 * variants, never a silent pick of a winner.
 */
function checkCombined(
  candidates: readonly VariantCandidate[],
  fresh: readonly CoreHierarchyNode[],
  display: DisplaySize,
): CombinedOutcome {
  // `default` is a fallback, not a component set: its designated required
  // elements are present in every state of the screen, so pairing it with
  // any other variant would report a false combined state on every screen.
  const specific = candidates.filter((candidate) => candidate.variantId !== DEFAULT_VARIANT_ID);
  for (let i = 0; i < specific.length; i += 1) {
    for (let j = i + 1; j < specific.length; j += 1) {
      const first = specific[i] as VariantCandidate;
      const second = specific[j] as VariantCandidate;
      if (!requiredFullyPresent(first, fresh, display)) continue;
      if (!requiredFullyPresent(second, fresh, display)) continue;
      const union = [...new Set([...first.required, ...second.required])];
      const combined = candidates.find((candidate) => sameIdSet(candidate.required, union));
      if (combined === undefined) return { kind: 'conflict', first: first.variantId, second: second.variantId };
      const match = checkCandidate(combined, fresh, display);
      if (match.fingerprint.matched) return { kind: 'combined', candidate: combined, evidence: match.fingerprint };
      return { kind: 'conflict', first: first.variantId, second: second.variantId };
    }
  }
  return { kind: 'none' };
}

/**
 * Detection precedence (B7): most-specific first — required count desc,
 * then excluded count desc, then alphabetical variant id — with `default`
 * always last.
 */
function compareSpecificity(left: VariantCandidate, right: VariantCandidate): number {
  if (left.variantId === DEFAULT_VARIANT_ID && right.variantId !== DEFAULT_VARIANT_ID) return 1;
  if (right.variantId === DEFAULT_VARIANT_ID && left.variantId !== DEFAULT_VARIANT_ID) return -1;
  if (left.required.length !== right.required.length) return right.required.length - left.required.length;
  if (left.excluded.length !== right.excluded.length) return right.excluded.length - left.excluded.length;
  return left.variantId.localeCompare(right.variantId);
}

/**
 * Detect the variant of one known screen from a fresh hierarchy dump.
 *
 * @param candidates - Learned variants of the screen (at least the default).
 * @param fresh - Fresh hierarchy dump nodes.
 * @param display - Visible display size for the B6 present rule.
 * @returns Matched variant, unknown with per-candidate evidence, or an
 *   ambiguous conflict naming both variants of a combined state.
 */
export function detectVariant(
  candidates: readonly VariantCandidate[],
  fresh: readonly CoreHierarchyNode[],
  display: DisplaySize,
): VariantDetectionResult {
  if (candidates.length === 0) {
    throw new Error('detectVariant requires at least one candidate variant.');
  }
  const screenId = (candidates[0] as VariantCandidate).screenId;
  const combined = checkCombined(candidates, fresh, display);
  if (combined.kind === 'combined') {
    return { kind: 'matched', screenId, variantId: combined.candidate.variantId, evidence: combined.evidence };
  }
  if (combined.kind === 'conflict') {
    return {
      kind: 'ambiguous',
      screenId,
      candidates: [combined.first, combined.second],
      reason:
        `Both variants "${combined.first}" and "${combined.second}" have all required elements present, ` +
        'and no combined variant matches. Learn the combined state with orbit learn.',
    };
  }
  const ordered = [...candidates].sort(compareSpecificity);
  const evidence: CandidateMatch[] = [];
  for (const candidate of ordered) {
    const match = checkCandidate(candidate, fresh, display);
    evidence.push(match);
    if (match.fingerprint.matched) {
      return { kind: 'matched', screenId, variantId: candidate.variantId, evidence: match.fingerprint };
    }
  }
  return { kind: 'unknown', screenId, checked: ordered.map((candidate) => candidate.variantId), evidence };
}

/** B7 score: required present minus excluded present (0 for passing candidates). */
function candidateScore(match: CandidateMatch): number {
  return match.candidate.required.length - match.fingerprint.excludedPresent.length;
}

/**
 * Identify the (screen, variant) of a fresh hierarchy dump from scratch.
 *
 * @param candidates - Every learned (screen, variant) across screens.
 * @param fresh - Fresh hierarchy dump nodes.
 * @param display - Visible display size for the B6 present rule.
 * @returns The single best passing candidate, unknown with evidence, or
 *   an ambiguous tie naming the candidates.
 */
export function identifyScreen(
  candidates: readonly VariantCandidate[],
  fresh: readonly CoreHierarchyNode[],
  display: DisplaySize,
): ScreenIdentificationResult {
  const checked = candidates.map((candidate) => `${candidate.screenId}.${candidate.variantId}`);
  const passing = candidates
    .map((candidate) => checkCandidate(candidate, fresh, display))
    .filter((match) => match.fingerprint.matched);
  if (passing.length === 0) {
    const evidence = candidates.map((candidate) => checkCandidate(candidate, fresh, display));
    return { kind: 'unknown', screenId: null, checked, evidence };
  }
  const ranked = [...passing].sort(
    (left, right) =>
      candidateScore(right) - candidateScore(left) ||
      right.candidate.required.length - left.candidate.required.length,
  );
  const best = ranked[0] as CandidateMatch;
  const tied = ranked.filter(
    (match) =>
      candidateScore(match) === candidateScore(best) &&
      match.candidate.required.length === best.candidate.required.length,
  );
  if (tied.length > 1) {
    return {
      kind: 'ambiguous',
      screenId: null,
      candidates: tied.map((match) => `${match.candidate.screenId}.${match.candidate.variantId}`),
      reason: 'Multiple learned (screen, variant) candidates pass with equal scores.',
    };
  }
  return {
    kind: 'matched',
    screenId: best.candidate.screenId,
    variantId: best.candidate.variantId,
    evidence: best.fingerprint,
  };
}
