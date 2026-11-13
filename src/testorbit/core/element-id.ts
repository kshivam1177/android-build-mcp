/**
 * Stable element identity (Part B, B3) — the one shared id function.
 *
 * An element id is `<screen>.<kebab-slug>` derived from the node's stable
 * selector (resourceId, else contentDesc, else nearest ancestor resourceId
 * + className). Text, bounds, and coordinates never enter an id, so an id
 * survives value changes, re-layout, and insertions above it.
 *
 * The one allowed positional component is the `#n` sibling index, within
 * an identical-selector group under the same parent only. Same selector
 * under different parents gets `@<nearest-ancestor-resourceId-slug>`.
 *
 * Pure function, no I/O. The only node import is `node:crypto` (SHA-256
 * for the truncation suffix).
 */
import { createHash } from 'node:crypto';
import { ElementIdentityError } from '../domain/errors.js';
import { TestOrbitError } from '../domain/errors.js';
import { toElementId } from '../domain/types.js';
import type { ElementId, IdentityNode, ScreenId } from '../domain/types.js';

/** Maximum length of the element slug, before the screen prefix. */
export const MAX_ELEMENT_SLUG_LENGTH = 50;
/** Hex characters of the SHA-256 suffix appended when a slug truncates. */
const HASH_SUFFIX_LENGTH = 6;

interface BaseIdentity {
  /** Truncated kebab slug of the stable selector's last segment. */
  slug: string;
  /** Grouping key: identical selectors share a key. */
  selectorKey: string;
  /** Slug of the nearest ancestor's resourceId last segment, if any. */
  ancestorSlug: string | undefined;
}

interface DerivedRecord {
  node: IdentityNode;
  baseId: string;
  selectorKey: string;
  parentRef: string | undefined;
  ancestorSlug: string | undefined;
  siblingIndex: number | undefined;
  crossParent: boolean;
  finalId: string;
}

/**
 * Slugify one segment: lowercase, non-alphanumerics become `-`, repeats
 * collapse, leading/trailing `-` trimmed.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Last segment after the final `/`; undefined when there is none. */
function lastSegment(value: string): string | undefined {
  const index = value.lastIndexOf('/');
  const segment = index >= 0 ? value.slice(index + 1) : value;
  return segment === '' ? undefined : segment;
}

/** Last segment of a dotted class name, e.g. `Button` from `android.widget.Button`. */
function classLastSegment(className: string): string {
  const index = className.lastIndexOf('.');
  return index >= 0 ? className.slice(index + 1) : className;
}

/** First 6 hex characters of the SHA-256 of the full slug. */
function hashSuffix(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, HASH_SUFFIX_LENGTH);
}

/**
 * Truncate a slug to 50 characters at a word boundary (`-`); when no word
 * boundary exists inside 50 characters, truncate at exactly 50. A
 * truncated slug always gains `-` + the hash suffix of the full slug, so
 * it stays unique.
 */
function truncateSlug(slug: string): string {
  if (slug.length <= MAX_ELEMENT_SLUG_LENGTH) return slug;
  const cut = slug.lastIndexOf('-', MAX_ELEMENT_SLUG_LENGTH);
  const base = cut > 0 ? slug.slice(0, cut) : slug.slice(0, MAX_ELEMENT_SLUG_LENGTH);
  return `${base}-${hashSuffix(slug)}`;
}

/**
 * Walk the node's ancestor chain from the nearest ancestor upward and
 * return the first resourceId found.
 */
function nearestAncestorResourceId(
  node: IdentityNode,
  byRef: ReadonlyMap<string, IdentityNode>,
): string | undefined {
  const chain = node.ancestorChain ?? [];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const ref = chain[i];
    if (ref === undefined) continue;
    const resourceId = byRef.get(ref)?.resourceId;
    if (resourceId !== undefined && resourceId !== '') return resourceId;
  }
  return undefined;
}

/** Slug of the nearest ancestor's resourceId last segment, if one exists. */
function nearestAncestorSlug(
  node: IdentityNode,
  byRef: ReadonlyMap<string, IdentityNode>,
): string | undefined {
  const resourceId = nearestAncestorResourceId(node, byRef);
  if (resourceId === undefined) return undefined;
  const segment = lastSegment(resourceId);
  if (segment === undefined) return undefined;
  const slug = slugify(segment);
  return slug === '' ? undefined : slug;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

/**
 * Derive the base identity of one node: resourceId first, else
 * contentDesc, else the nearest-ancestor-resourceId + className fallback.
 *
 * @throws ElementIdentityError when no identity source exists at all.
 */
function deriveBaseIdentity(
  node: IdentityNode,
  byRef: ReadonlyMap<string, IdentityNode>,
  screenId: ScreenId,
): BaseIdentity {
  const ancestorSlug = nearestAncestorSlug(node, byRef);
  const resourceId = nonEmpty(node.resourceId);
  if (resourceId !== undefined) {
    const slug = slugify(lastSegment(resourceId) ?? '');
    if (slug !== '') {
      return { slug, selectorKey: `rid:${resourceId}`, ancestorSlug };
    }
  }
  const contentDesc = nonEmpty(node.contentDesc);
  if (contentDesc !== undefined) {
    const slug = slugify(contentDesc);
    if (slug !== '') {
      return { slug, selectorKey: `cd:${contentDesc}`, ancestorSlug };
    }
  }
  const ancestorResourceId = nearestAncestorResourceId(node, byRef);
  if (ancestorResourceId !== undefined && ancestorSlug !== undefined) {
    const classSlug = node.className !== undefined ? slugify(classLastSegment(node.className)) : '';
    const slug = classSlug === '' ? ancestorSlug : `${ancestorSlug}-${classSlug}`;
    return { slug, selectorKey: `fb:${ancestorResourceId}|${node.className ?? ''}`, ancestorSlug };
  }
  throw new ElementIdentityError(
    `Cannot derive a stable element id for node ${node.ref} on screen "${screenId}": ` +
      'it has no resourceId and no contentDesc, and no ancestor carries a resourceId.',
    'Give the element a resourceId or a unique contentDesc, or add a resourceId to an ancestor container.',
    { ref: node.ref, className: node.className ?? '', screenId },
  );
}

/** Build one derivation record per target node. */
function toRecord(
  node: IdentityNode,
  screenId: ScreenId,
  byRef: ReadonlyMap<string, IdentityNode>,
): DerivedRecord {
  const base = deriveBaseIdentity(node, byRef, screenId);
  return {
    node,
    baseId: `${screenId}.${truncateSlug(base.slug)}`,
    selectorKey: base.selectorKey,
    parentRef: node.parentRef,
    ancestorSlug: base.ancestorSlug,
    siblingIndex: undefined,
    crossParent: false,
    finalId: '',
  };
}

/**
 * Assign the `#n` sibling index (1-based, document order) within each
 * identical-selector group under the same parent. Groups of one keep no
 * suffix — this is the one allowed positional component.
 */
function assignSiblingIndexes(records: DerivedRecord[]): void {
  const groups = new Map<string, DerivedRecord[]>();
  for (const record of records) {
    const key = `${record.parentRef ?? ''}\n${record.selectorKey}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((record, index) => {
      record.siblingIndex = index + 1;
    });
  }
}

/**
 * Mark records whose base id appears under more than one distinct parent:
 * each gets the `@<nearest-ancestor-slug>` disambiguator.
 */
function assignAncestorDisambiguators(records: DerivedRecord[]): void {
  const groups = new Map<string, DerivedRecord[]>();
  for (const record of records) {
    const group = groups.get(record.baseId) ?? [];
    group.push(record);
    groups.set(record.baseId, group);
  }
  for (const group of groups.values()) {
    const parents = new Set(group.map((record) => record.parentRef ?? ''));
    if (parents.size < 2) continue;
    for (const record of group) record.crossParent = true;
  }
}

/** Compose the final id from base id, `@ancestor`, and `#n` suffixes. */
function composeFinalIds(records: DerivedRecord[]): void {
  for (const record of records) {
    const ancestor = record.crossParent && record.ancestorSlug !== undefined ? `@${record.ancestorSlug}` : '';
    const sibling = record.siblingIndex !== undefined ? `#${record.siblingIndex}` : '';
    record.finalId = `${record.baseId}${ancestor}${sibling}`;
  }
}

/**
 * Pathological-collision guard (the plan is silent here): if two final ids
 * still collide — e.g. same selector under different parents whose nearest
 * ancestors share a slug — renumber the whole stem family in document
 * order. Specified cases never reach this branch.
 */
function ensureUniqueIds(records: DerivedRecord[]): void {
  const families = new Map<string, DerivedRecord[]>();
  for (const record of records) {
    const stem = record.finalId.replace(/#[0-9]+$/, '');
    const family = families.get(stem) ?? [];
    family.push(record);
    families.set(stem, family);
  }
  for (const [stem, family] of families) {
    const finals = new Set(family.map((record) => record.finalId));
    if (finals.size === family.length) continue;
    family.forEach((record, index) => {
      record.finalId = `${stem}#${index + 1}`;
    });
  }
}

/** Best-effort record for a context node; undefined when unidentifiable. */
function tryToRecord(
  node: IdentityNode,
  screenId: ScreenId,
  byRef: ReadonlyMap<string, IdentityNode>,
): DerivedRecord | undefined {
  try {
    return toRecord(node, screenId, byRef);
  } catch (error) {
    if (error instanceof ElementIdentityError) return undefined;
    throw error;
  }
}

/**
 * Collect derivation records in document order: every target must be
 * identifiable (failure throws), while a context node that cannot be
 * identified is skipped — it carries no selector, so it cannot collide
 * with any identifiable element.
 */
function collectRecords(
  targets: readonly IdentityNode[],
  screenId: ScreenId,
  allNodes: readonly IdentityNode[],
): { records: DerivedRecord[]; targetRecords: DerivedRecord[] } {
  const byRef = new Map(allNodes.map((node) => [node.ref, node]));
  const targetRefs = new Set(targets.map((node) => node.ref));
  const records: DerivedRecord[] = [];
  const targetRecords: DerivedRecord[] = [];
  const seen = new Set<string>();
  const addNode = (node: IdentityNode, required: boolean): void => {
    if (seen.has(node.ref)) return;
    seen.add(node.ref);
    if (required) {
      const record = toRecord(node, screenId, byRef);
      records.push(record);
      targetRecords.push(record);
      return;
    }
    const record = tryToRecord(node, screenId, byRef);
    if (record !== undefined) records.push(record);
  };
  for (const node of allNodes) addNode(node, targetRefs.has(node.ref));
  for (const target of targets) addNode(target, true);
  return { records, targetRecords };
}

/**
 * Derive stable element ids for a set of hierarchy nodes (B3).
 *
 * @param targets - Nodes to identify, in document order. A target that
 *   cannot be identified fails loudly with ElementIdentityError.
 * @param screenId - Screen the nodes belong to; prefixes every id.
 * @param allNodes - Full hierarchy: ancestor lookup plus the sibling and
 *   cross-parent groups. Unidentifiable non-targets are skipped.
 * @returns Map from target node ref to its stable ElementId.
 * @throws ElementIdentityError when a target node cannot be identified.
 */
export function deriveElementIds(
  targets: readonly IdentityNode[],
  screenId: ScreenId,
  allNodes: readonly IdentityNode[],
): ReadonlyMap<string, ElementId> {
  const { records, targetRecords } = collectRecords(targets, screenId, allNodes);
  assignSiblingIndexes(records);
  assignAncestorDisambiguators(records);
  composeFinalIds(records);
  ensureUniqueIds(records);
  return new Map(targetRecords.map((record) => [record.node.ref, toElementId(record.finalId)]));
}

/**
 * Derive the stable element id of one node, identified in the context of
 * the full node list (sibling groups and cross-parent collisions are
 * computed over that list, so pass the whole hierarchy).
 *
 * @param node - Node to identify.
 * @param screenId - Screen the node belongs to.
 * @param nodes - Full hierarchy the node belongs to, in document order.
 * @returns The node's stable ElementId.
 * @throws ElementIdentityError when the node cannot be identified.
 */
export function deriveElementId(
  node: IdentityNode,
  screenId: ScreenId,
  nodes: readonly IdentityNode[],
): ElementId {
  const ids = deriveElementIds(nodes, screenId, nodes);
  const id = ids.get(node.ref);
  if (id === undefined) {
    throw new TestOrbitError(
      'INTERNAL_ERROR',
      `deriveElementId produced no id for node ${node.ref}; this is an internal invariant failure.`,
      'Report this as a TestOrbit bug with the hierarchy that produced it.',
      { ref: node.ref, screenId },
    );
  }
  return id;
}
