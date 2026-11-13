/**
 * Learned-screen diff (Phase 3, safe re-learn) — what changed between
 * the previously learned screen and a fresh hierarchy dump, by stable
 * element id (B3).
 *
 * Vocabulary (B4): `removed` is the fingerprint's "missing", `added` is
 * an element in the fresh dump that was not learned, `changed` is a
 * stable element present in both sets whose `clickable` or `enabled`
 * differs. `renamed` is the re-learn-only case: an id that disappeared
 * whose stable selector reappears under a different id — the same
 * control learned under a new id (e.g. its ancestor disambiguator
 * changed), not a genuinely new element. A rename is reported once, as
 * a rename — never also as an added + removed pair.
 */
import type { ElementId, StableSelector } from '../domain/types.js';

/** Minimal element shape the diff needs: id, stable selector, state. */
export interface DiffableElement {
  id: ElementId;
  selector: StableSelector;
  clickable: boolean;
  enabled: boolean;
}

/** One element whose id changed but whose stable selector did not. */
export interface RenamedElement {
  from: ElementId;
  to: ElementId;
}

/** One element present in both sets whose clickable/enabled differs (B4). */
export interface ChangedLearnedElement {
  id: ElementId;
  field: 'clickable' | 'enabled';
  learned: boolean;
  fresh: boolean;
}

/** The diff between a previously learned screen and a fresh dump. */
export interface LearnScreenDiff {
  added: readonly ElementId[];
  removed: readonly ElementId[];
  renamed: readonly RenamedElement[];
  changed: readonly ChangedLearnedElement[];
}

/** Compare two stable selectors by their fields only, never text. */
function selectorKey(selector: StableSelector): string {
  const parts: string[] = [];
  if (selector.resourceId !== undefined) parts.push(`resourceId=${selector.resourceId}`);
  if (selector.contentDesc !== undefined) parts.push(`contentDesc=${selector.contentDesc}`);
  if (selector.className !== undefined) parts.push(`className=${selector.className}`);
  return parts.join('|');
}

/** Pair removed ids with added ids sharing an identical stable selector. */
function matchRenames(
  removed: readonly ElementId[],
  added: readonly ElementId[],
  oldById: ReadonlyMap<ElementId, DiffableElement>,
  freshById: ReadonlyMap<ElementId, DiffableElement>,
): { renamed: RenamedElement[]; addedRest: ElementId[]; removedRest: ElementId[] } {
  const renamed: RenamedElement[] = [];
  const addedLeft = new Set(added);
  const removedLeft: ElementId[] = [];
  const addedBySelector = new Map<string, ElementId[]>();
  for (const id of added) {
    const element = freshById.get(id) as DiffableElement;
    const key = selectorKey(element.selector);
    const bucket = addedBySelector.get(key) ?? [];
    bucket.push(id);
    addedBySelector.set(key, bucket);
  }
  for (const id of removed) {
    const element = oldById.get(id) as DiffableElement;
    const bucket = addedBySelector.get(selectorKey(element.selector)) ?? [];
    const match = bucket.shift();
    if (match === undefined) {
      removedLeft.push(id);
      continue;
    }
    addedLeft.delete(match);
    renamed.push({ from: id, to: match });
  }
  return { renamed, addedRest: [...addedLeft].sort(), removedRest: removedLeft };
}

/** Elements present in both sets whose clickable/enabled differs (B4). */
function findChanged(
  oldElements: readonly DiffableElement[],
  freshById: ReadonlyMap<ElementId, DiffableElement>,
): ChangedLearnedElement[] {
  const changed: ChangedLearnedElement[] = [];
  for (const old of oldElements) {
    const fresh = freshById.get(old.id);
    if (fresh === undefined) continue;
    if (old.clickable !== fresh.clickable) {
      changed.push({ id: old.id, field: 'clickable', learned: old.clickable, fresh: fresh.clickable });
    }
    if (old.enabled !== fresh.enabled) {
      changed.push({ id: old.id, field: 'enabled', learned: old.enabled, fresh: fresh.enabled });
    }
  }
  return changed.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Diff a previously learned screen against a fresh dump.
 *
 * @param oldElements - Elements of the previously learned `elements.json`.
 * @param freshElements - Elements of the fresh hierarchy dump.
 * @returns Added, removed, renamed, and changed element ids, all sorted.
 */
export function diffLearnedScreens(
  oldElements: readonly DiffableElement[],
  freshElements: readonly DiffableElement[],
): LearnScreenDiff {
  const oldById = new Map(oldElements.map((element) => [element.id, element]));
  const freshById = new Map(freshElements.map((element) => [element.id, element]));
  const added = freshElements
    .map((element) => element.id)
    .filter((id) => !oldById.has(id))
    .sort();
  const removed = oldElements
    .map((element) => element.id)
    .filter((id) => !freshById.has(id))
    .sort();
  const { renamed, addedRest, removedRest } = matchRenames(removed, added, oldById, freshById);
  return { added: addedRest, removed: removedRest, renamed, changed: findChanged(oldElements, freshById) };
}

/**
 * True when the diff reports no added, removed, renamed, or changed element.
 *
 * @param diff - A diff from `diffLearnedScreens`.
 * @returns True when the fresh dump matches the learned screen exactly.
 */
export function isLearnScreenDiffEmpty(diff: LearnScreenDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.renamed.length === 0 && diff.changed.length === 0;
}

/**
 * One-line human summary of a diff, for refusal messages and tool results.
 *
 * @param diff - A diff from `diffLearnedScreens`.
 * @returns E.g. `2 added, 1 removed, 1 renamed, 1 changed`, or `no changes`.
 */
export function describeLearnScreenDiff(diff: LearnScreenDiff): string {
  if (isLearnScreenDiffEmpty(diff)) return 'no changes';
  const parts: string[] = [];
  if (diff.added.length > 0) parts.push(`${diff.added.length} added (${diff.added.join(', ')})`);
  if (diff.removed.length > 0) parts.push(`${diff.removed.length} removed (${diff.removed.join(', ')})`);
  if (diff.renamed.length > 0) {
    parts.push(`${diff.renamed.length} renamed (${diff.renamed.map((pair) => `${pair.from} → ${pair.to}`).join(', ')})`);
  }
  if (diff.changed.length > 0) {
    parts.push(
      `${diff.changed.length} changed (${diff.changed.map((entry) => `${entry.id}: ${entry.field} ${String(entry.learned)} → ${String(entry.fresh)}`).join(', ')})`,
    );
  }
  return parts.join('; ');
}
