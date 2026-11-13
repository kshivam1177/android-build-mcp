import { describe, expect, it } from 'vitest';
import { findPresentNode, isInteractiveNode, isNodePresent } from './screen-identity.js';
import type { CoreHierarchyNode } from '../domain/types.js';

const DISPLAY = { width: 1080, height: 2400 };

function node(bounds: CoreHierarchyNode['bounds'], overrides: Partial<CoreHierarchyNode> = {}): CoreHierarchyNode {
  const built: CoreHierarchyNode = { ref: 'e1', bounds, clickable: true, enabled: true };
  if (overrides.resourceId !== undefined) built.resourceId = overrides.resourceId;
  if (overrides.className !== undefined) built.className = overrides.className;
  return built;
}

describe('isNodePresent', () => {
  it('is present when fully inside the display', () => {
    expect(isNodePresent(node({ left: 10, top: 20, right: 110, bottom: 70 }), DISPLAY)).toBe(true);
  });

  it('is present when partially off-screen but intersecting the display', () => {
    expect(isNodePresent(node({ left: -50, top: 20, right: 50, bottom: 70 }), DISPLAY)).toBe(true);
    expect(isNodePresent(node({ left: 1000, top: 20, right: 1200, bottom: 70 }), DISPLAY)).toBe(true);
  });

  it('is absent when fully outside the display', () => {
    expect(isNodePresent(node({ left: 1100, top: 20, right: 1200, bottom: 70 }), DISPLAY)).toBe(false);
    expect(isNodePresent(node({ left: 10, top: 2500, right: 110, bottom: 2600 }), DISPLAY)).toBe(false);
    expect(isNodePresent(node({ left: -200, top: 20, right: -100, bottom: 70 }), DISPLAY)).toBe(false);
  });

  it('is absent when zero-area', () => {
    expect(isNodePresent(node({ left: 10, top: 20, right: 10, bottom: 70 }), DISPLAY)).toBe(false);
    expect(isNodePresent(node({ left: 10, top: 20, right: 110, bottom: 20 }), DISPLAY)).toBe(false);
  });
});

describe('findPresentNode', () => {
  it('returns a matching node that is on screen', () => {
    const nodes = [node({ left: 10, top: 20, right: 110, bottom: 70 }, { resourceId: 'com.shop.app:id/pay_now' })];
    expect(findPresentNode(nodes, { resourceId: 'com.shop.app:id/pay_now' }, DISPLAY)?.ref).toBe('e1');
  });

  it('treats a matching but off-screen node as absent', () => {
    const nodes = [node({ left: 10, top: 2500, right: 110, bottom: 2600 }, { resourceId: 'com.shop.app:id/pay_now' })];
    expect(findPresentNode(nodes, { resourceId: 'com.shop.app:id/pay_now' }, DISPLAY)).toBeUndefined();
  });

  it('skips an off-screen match and returns a later on-screen one', () => {
    const nodes = [
      node({ left: 10, top: 2500, right: 110, bottom: 2600 }, { resourceId: 'com.shop.app:id/pay_now' }),
      node({ left: 10, top: 20, right: 110, bottom: 70 }, { resourceId: 'com.shop.app:id/pay_now' }),
    ];
    expect(findPresentNode(nodes, { resourceId: 'com.shop.app:id/pay_now' }, DISPLAY)?.bounds.top).toBe(20);
  });
});

describe('isInteractiveNode', () => {
  it('counts clickable, focusable, and checkable nodes as interactive', () => {
    expect(isInteractiveNode({ clickable: true, focusable: false, checkable: false })).toBe(true);
    expect(isInteractiveNode({ clickable: false, focusable: true, checkable: false })).toBe(true);
    expect(isInteractiveNode({ clickable: false, focusable: false, checkable: true })).toBe(true);
    expect(isInteractiveNode({ clickable: false, focusable: false, checkable: false })).toBe(false);
  });
});
