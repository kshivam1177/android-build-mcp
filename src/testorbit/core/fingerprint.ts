/**
 * Fingerprint v2 (Part B, B4) — set comparison only, never a hash check.
 *
 * The run-time check compares the learned base ∪ variant set against a
 * fresh hierarchy dump: (i) all required elements present, (ii) all
 * excluded elements absent, (iii) missing + added non-required elements
 * within `floor(0.10 × n)` of the non-required count. The SHA-256 hash is
 * demoted to a version stamp (`computeFingerprintStamp`); it is never a
 * run-time check. The match returns the exact diff — missing, added, and
 * changed elements — plus warnings, not just true/false.
 *
 * Text changes and bounds movement are warnings only. A `changed`
 * element (clickable/enabled differs) on a required element fails
 * clause (i); on a non-required element it is a warning only.
 */
import { createHash } from 'node:crypto';
import { findPresentNode } from './screen-identity.js';
import { isInteractiveNode } from './screen-identity.js';
import { matchesStableSelector, stableSelectorOf } from './matcher.js';
import type { CoreHierarchyNode, ElementId, NodeBounds, StableSelector } from '../domain/types.js';

/** Fraction of non-required elements allowed to drift (missing + added). */
export const DRIFT_RATE = 0.1;

/** A learned element as the fingerprint consumes it (base ∪ variant). */
export interface LearnedFingerprintElement {
  id: ElementId;
  selector: StableSelector;
  clickable: boolean;
  enabled: boolean;
  text?: string;
  bounds?: NodeBounds;
}

/** One element whose clickable/enabled differs from the learned value. */
export interface FingerprintChangedElement {
  id: ElementId;
  field: 'clickable' | 'enabled';
  learned: boolean;
  fresh: boolean;
}

/** One fresh interactive element whose selector is not in the learned set. */
export interface FingerprintAddedElement {
  ref: string;
  selector: StableSelector;
}

/** The clause (iii) drift budget and how much of it was used. */
export interface FingerprintDriftBudget {
  nonRequiredCount: number;
  allowedDrift: number;
  usedDrift: number;
}

/** The exact diff a fingerprint match returns. */
export interface FingerprintMatchResult {
  matched: boolean;
  missingRequired: readonly ElementId[];
  missingNonRequired: readonly ElementId[];
  added: readonly FingerprintAddedElement[];
  changedRequired: readonly FingerprintChangedElement[];
  changedNonRequired: readonly FingerprintChangedElement[];
  excludedPresent: readonly ElementId[];
  warnings: readonly string[];
  budget: FingerprintDriftBudget;
}

/** Inputs to the fingerprint v2 set-match. */
export interface FingerprintCheckInput {
  /** Learned base ∪ variant elements (interactive only). */
  learned: readonly LearnedFingerprintElement[];
  /** Elements that must be present (ids reference `learned`). */
  required: readonly ElementId[];
  /** Elements that must be absent (id + selector, from other variants). */
  excluded: readonly LearnedFingerprintElement[];
  /** Fresh hierarchy dump nodes. */
  fresh: readonly CoreHierarchyNode[];
  /** Visible display size for the B6 present rule. */
  display: { width: number; height: number };
}

const SYSTEM_CHROME_PACKAGES = ['com.android.systemui'];
const SYSTEM_CHROME_RESOURCE_IDS = ['android:id/statusBarBackground', 'android:id/navigationBarBackground'];

/**
 * Whether a fresh node is system chrome (status bar, navigation bar,
 * keyboard) — excluded from the `added` count. Interpretation: the plan
 * names the categories; the package/resourceId list is the Phase 1 rule.
 */
function isSystemChromeNode(node: CoreHierarchyNode): boolean {
  if (node.packageName !== undefined && SYSTEM_CHROME_PACKAGES.includes(node.packageName)) return true;
  if (node.packageName !== undefined && node.packageName.includes('inputmethod')) return true;
  if (node.resourceId !== undefined && node.resourceId.startsWith('com.android.systemui')) return true;
  return node.resourceId !== undefined && SYSTEM_CHROME_RESOURCE_IDS.includes(node.resourceId);
}

/** Canonical JSON of one stable selector (fixed key order, no text/bounds). */
function canonicalSelector(selector: StableSelector): string {
  const ordered: StableSelector = {};
  if (selector.resourceId !== undefined) ordered.resourceId = selector.resourceId;
  if (selector.contentDesc !== undefined) ordered.contentDesc = selector.contentDesc;
  if (selector.className !== undefined) ordered.className = selector.className;
  return JSON.stringify(ordered);
}

/**
 * Version stamp of a learned stable-selector set: SHA-256 of the sorted
 * canonical selectors. A stamp only — never a run-time check.
 *
 * @param selectors - Stable selectors of the learned set.
 * @returns Hex SHA-256 of the canonical set.
 */
export function computeFingerprintStamp(selectors: readonly StableSelector[]): string {
  const canonical = selectors.map(canonicalSelector).sort();
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Inputs to a variant file's `fingerprintStamp` (B2). */
export interface VariantStampInput {
  screenId: string;
  variantId: string;
  required: readonly ElementId[];
  optional: readonly ElementId[];
  excluded: readonly ElementId[];
}

/**
 * Compute a variant file's `fingerprintStamp` (B2): SHA-256 of the
 * canonical content — screen and variant ids plus the sorted
 * required/optional/excluded sets — excluding the stamp field itself, so
 * the stamp is never self-referential. A provenance/version stamp only;
 * the run-time check is the set comparison in `matchFingerprint`.
 *
 * @param input - Screen/variant ids and the three element-id sets.
 * @returns `sha256:<hex>` of the canonical content.
 */
export function computeVariantFingerprintStamp(input: VariantStampInput): string {
  const canonical = JSON.stringify({
    screenId: input.screenId,
    variantId: input.variantId,
    required: [...input.required].sort(),
    optional: [...input.optional].sort(),
    excluded: [...input.excluded].sort(),
  });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

interface PresenceOutcome {
  missingRequired: ElementId[];
  missingNonRequired: ElementId[];
  changedRequired: FingerprintChangedElement[];
  changedNonRequired: FingerprintChangedElement[];
  warnings: string[];
}

/** One changed entry per differing clickable/enabled field. */
function changedEntriesFor(
  element: LearnedFingerprintElement,
  freshNode: CoreHierarchyNode,
): FingerprintChangedElement[] {
  const entries: FingerprintChangedElement[] = [];
  if (freshNode.clickable !== element.clickable) {
    entries.push({ id: element.id, field: 'clickable', learned: element.clickable, fresh: freshNode.clickable });
  }
  if (freshNode.enabled !== element.enabled) {
    entries.push({ id: element.id, field: 'enabled', learned: element.enabled, fresh: freshNode.enabled });
  }
  return entries;
}

/** Bounds drift warning, when the learned bounds are known and moved. */
function boundsWarning(element: LearnedFingerprintElement, freshNode: CoreHierarchyNode): string | undefined {
  const learned = element.bounds;
  if (learned === undefined) return undefined;
  const fresh = freshNode.bounds;
  const moved = learned.left !== fresh.left || learned.top !== fresh.top || learned.right !== fresh.right || learned.bottom !== fresh.bottom;
  return moved ? `bounds moved on ${element.id}` : undefined;
}

/**
 * Check every learned element against the fresh dump: missing, changed,
 * and text/bounds warnings. A required element that is present but
 * changed-disabled fails clause (i) via `changedRequired`.
 */
function checkLearnedElements(
  input: FingerprintCheckInput,
  requiredSet: ReadonlySet<ElementId>,
): PresenceOutcome {
  const outcome: PresenceOutcome = {
    missingRequired: [],
    missingNonRequired: [],
    changedRequired: [],
    changedNonRequired: [],
    warnings: [],
  };
  for (const element of input.learned) {
    const isRequired = requiredSet.has(element.id);
    const freshNode = findPresentNode(input.fresh, element.selector, input.display);
    if (freshNode === undefined) {
      if (isRequired) outcome.missingRequired.push(element.id);
      else outcome.missingNonRequired.push(element.id);
      continue;
    }
    const changed = changedEntriesFor(element, freshNode);
    if (isRequired) outcome.changedRequired.push(...changed);
    else outcome.changedNonRequired.push(...changed);
    if (element.text !== undefined && freshNode.text !== undefined && freshNode.text !== element.text) {
      outcome.warnings.push(`text changed on ${element.id}: "${element.text}" → "${freshNode.text}"`);
    }
    const moved = boundsWarning(element, freshNode);
    if (moved !== undefined) outcome.warnings.push(moved);
  }
  for (const element of input.required) {
    if (input.learned.some((item) => item.id === element)) continue;
    outcome.missingRequired.push(element);
  }
  return outcome;
}

/** Excluded elements that are present in the fresh dump (clause (ii)). */
function checkExcludedPresent(input: FingerprintCheckInput): ElementId[] {
  const present: ElementId[] = [];
  for (const element of input.excluded) {
    if (findPresentNode(input.fresh, element.selector, input.display) !== undefined) {
      present.push(element.id);
    }
  }
  return present;
}

/**
 * Fresh interactive elements whose selector is in neither the learned set
 * nor the excluded set, excluding system chrome. Excluded matches are
 * reported under `excludedPresent`, never double-counted as added.
 */
function collectAddedElements(
  input: FingerprintCheckInput,
  knownSelectors: readonly StableSelector[],
): FingerprintAddedElement[] {
  const added: FingerprintAddedElement[] = [];
  for (const node of input.fresh) {
    if (!isInteractiveNode(node) || isSystemChromeNode(node)) continue;
    if (knownSelectors.some((selector) => matchesStableSelector(node, selector))) continue;
    added.push({ ref: node.ref, selector: stableSelectorOf(node) });
  }
  return added;
}

/**
 * Run the fingerprint v2 set-match (B4).
 *
 * @param input - Learned set, required/excluded ids, fresh dump, display.
 * @returns The match verdict with the exact diff and warnings.
 */
export function matchFingerprint(input: FingerprintCheckInput): FingerprintMatchResult {
  const requiredSet = new Set(input.required);
  const presence = checkLearnedElements(input, requiredSet);
  const excludedPresent = checkExcludedPresent(input);
  const knownSelectors = [
    ...input.learned.map((element) => element.selector),
    ...input.excluded.map((element) => element.selector),
  ];
  const added = collectAddedElements(input, knownSelectors);
  const nonRequiredCount = input.learned.filter((element) => !requiredSet.has(element.id)).length;
  const allowedDrift = Math.floor(DRIFT_RATE * nonRequiredCount);
  const usedDrift = presence.missingNonRequired.length + added.length;
  const warnings = [...presence.warnings];
  for (const changed of presence.changedNonRequired) {
    warnings.push(
      `element ${changed.id} changed ${changed.field}: learned ${changed.learned} → fresh ${changed.fresh} (non-required, warning only)`,
    );
  }
  if (usedDrift > 0 && usedDrift <= allowedDrift) {
    warnings.push(
      `element-count drift: ${usedDrift} of ${nonRequiredCount} non-required elements missing or added (budget ${allowedDrift})`,
    );
  }
  const matched =
    presence.missingRequired.length === 0 &&
    presence.changedRequired.length === 0 &&
    excludedPresent.length === 0 &&
    usedDrift <= allowedDrift;
  return {
    matched,
    missingRequired: presence.missingRequired,
    missingNonRequired: presence.missingNonRequired,
    added,
    changedRequired: presence.changedRequired,
    changedNonRequired: presence.changedNonRequired,
    excludedPresent,
    warnings,
    budget: { nonRequiredCount, allowedDrift, usedDrift },
  };
}

/** Render the exact diff as a human-readable multi-line string. */
export function describeFingerprintDiff(result: FingerprintMatchResult): string {
  const lines: string[] = [`screen match: ${result.matched ? 'matched' : 'did not match'}`];
  const list = (label: string, values: readonly string[]): void => {
    if (values.length > 0) lines.push(`  ${label}: ${values.join(', ')}`);
  };
  list('missing required', result.missingRequired);
  list('missing (non-required)', result.missingNonRequired);
  list('added', result.added.map((item) => `${item.ref} ${JSON.stringify(item.selector)}`));
  list(
    'changed required',
    result.changedRequired.map((item) => `${item.id} (${item.field}: learned ${item.learned} → fresh ${item.fresh})`),
  );
  list('excluded present', result.excludedPresent);
  list('warnings', result.warnings);
  lines.push(
    `  drift: ${result.budget.usedDrift} used of ${result.budget.allowedDrift} allowed (n=${result.budget.nonRequiredCount})`,
  );
  return lines.join('\n');
}
