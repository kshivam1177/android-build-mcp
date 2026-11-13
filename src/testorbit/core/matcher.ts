/**
 * The stable-selector matcher (Part B, B5) — the only element-matching
 * code in TestOrbit.
 *
 * Compares only the stable-selector fields (`resourceId`, `contentDesc`,
 * `className`) — never `text`, never exact bounds, never coordinates.
 * Only fields present in the stored selector are compared: when the live
 * node lacks a stored field, that field is skipped, not a mismatch. A
 * missed match fails loudly at the call site; it never degrades to a
 * coordinate tap.
 */
import type { CoreHierarchyNode, StableSelector } from '../domain/types.js';

type SelectorField = 'resourceId' | 'contentDesc' | 'className';
const SELECTOR_FIELDS: readonly SelectorField[] = ['resourceId', 'contentDesc', 'className'];

/** The fields a matchable node exposes for stable-selector comparison. */
export type MatchableNode = Pick<CoreHierarchyNode, SelectorField>;

/**
 * Check whether a live node matches a stored stable selector.
 *
 * Only fields present in the stored selector are compared: when the
 * live node lacks a stored field, that field is skipped, not a
 * mismatch. But at least one stored field must be present on the node
 * and equal — a node carrying none of the stored fields is not a
 * match. Without this, a container node with no `resourceId` (the
 * root of every real uiautomator dump) vacuously matches every
 * selector, `findPresentNode` returns the root for every element, and
 * variant detection reports every screen unknown (found in Phase 5,
 * when the first real-XML dump was identified).
 *
 * @param node - Live hierarchy node.
 * @param selector - Stored stable selector (stable fields only).
 * @returns True when at least one stored field is shared and equal,
 *   and no stored field the node carries differs.
 */
export function matchesStableSelector(node: MatchableNode, selector: StableSelector): boolean {
  let shared = false;
  for (const field of SELECTOR_FIELDS) {
    const expected = selector[field];
    if (expected === undefined) continue;
    const actual = node[field];
    if (actual === undefined) continue;
    if (actual !== expected) return false;
    shared = true;
  }
  return shared;
}

/**
 * Find the first node in a fresh dump matching a stored stable selector.
 *
 * @param nodes - Fresh hierarchy nodes, in document order.
 * @param selector - Stored stable selector.
 * @returns The first matching node, or undefined when none matches.
 */
export function findMatchingNode<T extends MatchableNode>(
  nodes: readonly T[],
  selector: StableSelector,
): T | undefined {
  return nodes.find((node) => matchesStableSelector(node, selector));
}

/**
 * Extract the stable selector of a node: stable fields only, text dropped,
 * absent fields omitted. This replaces the old `selectorFor`, which kept
 * `text` (B5 clean break).
 *
 * @param node - Hierarchy node to read the selector from.
 * @returns The node's stable selector, possibly empty.
 */
export function stableSelectorOf(node: MatchableNode): StableSelector {
  const selector: StableSelector = {};
  if (node.resourceId !== undefined) selector.resourceId = node.resourceId;
  if (node.contentDesc !== undefined) selector.contentDesc = node.contentDesc;
  if (node.className !== undefined) selector.className = node.className;
  return selector;
}
