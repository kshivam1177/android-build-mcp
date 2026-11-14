/**
 * Flutter / Patrol tree reader (Phase 2) — converts a Patrol semantics
 * tree dump into the same `CoreHierarchyNode` shape the matcher consumes.
 *
 * Mechanism (named in the plan): the Flutter app is built with Patrol
 * integrated (`patrol` in `dev_dependencies`) and the harness test
 * `integration_test/testorbit_tree_dump_test.dart` (run with `patrol test`)
 * dumps the app's semantics tree to JSON under the pilot tree; this
 * reader converts that JSON. Patrol is the tree *source*; this file is
 * the reader.
 *
 * Semantics contract — the app must expose `Semantics` labels on
 * interactive elements (label + `ValueKey` for stable ids); the reader
 * consumes whatever semantics the app exposes and cannot invent labels
 * the app does not provide. A `ValueKey` value becomes the node's
 * `resourceId`; the semantics `label` becomes its `contentDesc` and the
 * `value` its `text`. If the Flutter app's semantics coverage is below
 * the ≥80% rule (B3), it is out of v1 scope until the labels are added.
 *
 * Fallback (named, not built): `appium-flutter-driver` over the Dart VM
 * service, decided live if Patrol cannot serve the tree this way.
 * The no-tree visual replay path (re-grounding at replay) is out of v1.
 *
 * Live run pending: no Flutter SDK / Patrol on this VM — the harness is
 * written and the reader is proved against fixture JSON; run
 * `patrol test` on a machine with the Flutter SDK + pilot app.
 */
import { z } from 'zod';
import { TestOrbitError } from '../domain/errors.js';
import type { CoreHierarchyNode } from '../domain/types.js';

/** One node of the Patrol semantics dump (the harness's JSON contract). */
export const PatrolSemanticsNodeSchema = z
  .object({
    key: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    value: z.string().optional(),
    hint: z.string().optional(),
    type: z.string().min(1).optional(),
    rect: z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }).strict(),
    flags: z
      .object({
        button: z.boolean().optional(),
        textField: z.boolean().optional(),
        enabled: z.boolean().optional(),
        focusable: z.boolean().optional(),
        checkable: z.boolean().optional(),
        checked: z.boolean().optional(),
        scrollable: z.boolean().optional(),
      })
      .strict()
      .optional(),
    children: z.array(z.unknown()).optional(),
  })
  .strict();

export type PatrolSemanticsNode = z.infer<typeof PatrolSemanticsNodeSchema>;

/** Class name when the dump carries no explicit `type`. */
function classNameOf(node: PatrolSemanticsNode): string {
  if (node.type !== undefined) return node.type;
  if (node.flags?.button === true) return 'FlutterButton';
  if (node.flags?.textField === true) return 'FlutterTextField';
  return 'FlutterSemanticsNode';
}

/** Convert one Patrol node (and its subtree) into core nodes, pre-order. */
function convertNode(
  node: PatrolSemanticsNode,
  out: CoreHierarchyNode[],
  parentRef: string | undefined,
  ancestorChain: readonly string[],
): void {
  const ref = `f${out.length + 1}`;
  const core: CoreHierarchyNode = {
    ref,
    bounds: node.rect,
    clickable: node.flags?.button === true || node.flags?.textField === true,
    enabled: node.flags?.enabled ?? true,
  };
  if (node.key !== undefined) core.resourceId = node.key;
  if (node.label !== undefined) core.contentDesc = node.label;
  core.className = classNameOf(node);
  if (node.value !== undefined) core.text = node.value;
  else if (node.label !== undefined) core.text = node.label;
  if (parentRef !== undefined) core.parentRef = parentRef;
  core.ancestorChain = ancestorChain;
  if (node.flags?.focusable === true) core.focusable = true;
  if (node.flags?.checkable === true) core.checkable = true;
  out.push(core);
  for (const child of node.children ?? []) {
    const parsed = PatrolSemanticsNodeSchema.safeParse(child);
    if (parsed.success) convertNode(parsed.data, out, ref, [...ancestorChain, ref]);
  }
}

/**
 * Parse a Patrol semantics tree dump into core hierarchy nodes.
 *
 * @param payload - Parsed JSON of the dump: one root semantics node.
 * @returns Core nodes in document order, with parent refs and ancestor
 *   chains.
 * @throws TestOrbitError when the payload is not a semantics node.
 */
export function parsePatrolTree(payload: unknown): CoreHierarchyNode[] {
  const parsed = PatrolSemanticsNodeSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new TestOrbitError(
      'PATROL_TREE_INVALID',
      `Patrol semantics dump is not a valid tree: ${issues}`,
      'Run the testorbit_tree_dump_test.dart harness again and check the dump file.',
      {},
    );
  }
  const nodes: CoreHierarchyNode[] = [];
  convertNode(parsed.data, nodes, undefined, []);
  return nodes;
}
