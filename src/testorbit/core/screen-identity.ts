/**
 * Screen identity (Part B, B6): what "present" means, operationally.
 *
 * A node is present when a node matching the stable selector exists in the
 * fresh dump AND its bounds intersect the visible display area AND its
 * width and height are both > 0. Off-screen and zero-area nodes count as
 * absent; a scroll step brings off-screen nodes in. For clause (i) of the
 * fingerprint match, present additionally means not changed-disabled —
 * that check lives in `fingerprint.ts`, not here.
 */
import { matchesStableSelector } from './matcher.js';
import type { CoreHierarchyNode, NodeBounds, StableSelector } from '../domain/types.js';

/** Visible display area, in absolute pixels. */
export interface DisplaySize {
  width: number;
  height: number;
}

/** The flags that make a hierarchy node an interactive element (B4). */
export interface InteractivityFlags {
  clickable: boolean;
  focusable?: boolean;
  checkable?: boolean;
}

/**
 * Whether a node is an interactive element: clickable, focusable, or
 * checkable. Only interactive elements enter learned sets and fingerprints.
 */
export function isInteractiveNode(node: InteractivityFlags): boolean {
  return node.clickable || node.focusable === true || node.checkable === true;
}

/**
 * Whether a node's bounds count as on screen: width and height > 0 and
 * the bounds intersect the visible display area.
 *
 * @param node - Node carrying bounds.
 * @param display - Visible display size.
 * @returns True when the node is visible on screen.
 */
export function isNodePresent(node: { bounds: NodeBounds }, display: DisplaySize): boolean {
  const { bounds } = node;
  if (bounds.right - bounds.left <= 0 || bounds.bottom - bounds.top <= 0) return false;
  return bounds.left < display.width && bounds.right > 0 && bounds.top < display.height && bounds.bottom > 0;
}

/**
 * Find the first present node matching a stored stable selector.
 *
 * @param nodes - Fresh hierarchy nodes, in document order.
 * @param selector - Stored stable selector.
 * @param display - Visible display size.
 * @returns The first matching present node, or undefined.
 */
export function findPresentNode<T extends CoreHierarchyNode>(
  nodes: readonly T[],
  selector: StableSelector,
  display: DisplaySize,
): T | undefined {
  return nodes.find((node) => matchesStableSelector(node, selector) && isNodePresent(node, display));
}
