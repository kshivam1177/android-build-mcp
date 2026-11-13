/**
 * Synthetic hierarchy fixtures for unit-testing pure TestOrbit logic ONLY.
 *
 * These are test data — never flows, never shipped as example tests, never
 * a stand-in for a real app. The large-hierarchy generator exists to
 * measure the hierarchy-dump cost budget (Phase 1 task 7): parse cost in
 * ms per dump on a realistic-size fixture hierarchy.
 */
import type { CoreHierarchyNode } from '../domain/types.js';

/** Nodes per container in the generated tree (leaves, excluding the container itself). */
const LEAVES_PER_CONTAINER = 10;

function containerXml(index: number): string {
  return `<node index="${index}" text="" resource-id="com.example.app:id/section_${index}" class="android.widget.LinearLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">`;
}

function leafXml(index: number, id: number): string {
  return `<node index="${index}" text="Item ${id}" resource-id="com.example.app:id/item_${id}" class="android.widget.Button" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,${id % 2400}][200,${(id % 2400) + 80}]"></node>`;
}

/**
 * Generate a deterministic synthetic uiautomator hierarchy XML with the
 * requested node count: one root, then containers of 10 leaf buttons each.
 *
 * @param nodeCount - Total nodes to generate (root included, at least 1).
 * @returns uiautomator-format hierarchy XML.
 */
export function generateLargeHierarchyXml(nodeCount: number): string {
  const count = Math.max(1, Math.floor(nodeCount));
  const parts: string[] = [
    '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?>',
    '<hierarchy rotation="0">',
    '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">',
  ];
  let made = 1;
  let container = 0;
  while (made < count) {
    container += 1;
    parts.push(containerXml(container));
    made += 1;
    for (let leaf = 0; leaf < LEAVES_PER_CONTAINER && made < count; leaf += 1) {
      made += 1;
      parts.push(leafXml(leaf, made));
    }
    parts.push('</node>');
  }
  parts.push('</node>', '</hierarchy>');
  return parts.join('\n');
}

/**
 * Generate the parsed-node equivalent of `generateLargeHierarchyXml`:
 * the same tree as `CoreHierarchyNode`s with parent refs and ancestor
 * chains, for timing id derivation without a parse step.
 *
 * @param nodeCount - Total nodes to generate (root included, at least 1).
 * @returns Hierarchy nodes in document order.
 */
export function generateLargeHierarchyNodes(nodeCount: number): CoreHierarchyNode[] {
  const count = Math.max(1, Math.floor(nodeCount));
  const nodes: CoreHierarchyNode[] = [
    {
      ref: 'e1',
      className: 'android.widget.FrameLayout',
      packageName: 'com.example.app',
      bounds: { left: 0, top: 0, right: 1080, bottom: 2400 },
      clickable: false,
      enabled: true,
      ancestorChain: [],
    },
  ];
  let made = 1;
  let container = 0;
  while (made < count) {
    container += 1;
    const containerRef = `e${made + 1}`;
    nodes.push({
      ref: containerRef,
      resourceId: `com.example.app:id/section_${container}`,
      className: 'android.widget.LinearLayout',
      packageName: 'com.example.app',
      bounds: { left: 0, top: 0, right: 1080, bottom: 2400 },
      clickable: false,
      enabled: true,
      parentRef: 'e1',
      ancestorChain: ['e1'],
    });
    made += 1;
    for (let leaf = 0; leaf < LEAVES_PER_CONTAINER && made < count; leaf += 1) {
      made += 1;
      nodes.push({
        ref: `e${made}`,
        resourceId: `com.example.app:id/item_${made}`,
        text: `Item ${made}`,
        className: 'android.widget.Button',
        packageName: 'com.example.app',
        bounds: { left: 0, top: made % 2400, right: 200, bottom: (made % 2400) + 80 },
        clickable: true,
        enabled: true,
        focusable: true,
        parentRef: containerRef,
        ancestorChain: ['e1', containerRef],
      });
    }
  }
  return nodes;
}
