import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveElementId, deriveElementIds, MAX_ELEMENT_SLUG_LENGTH } from './element-id.js';
import { ElementIdentityError } from '../domain/errors.js';
import { toScreenId } from '../domain/types.js';
import type { IdentityNode } from '../domain/types.js';

const SCREEN = toScreenId('checkout');

type NodeFields = { resourceId?: string; contentDesc?: string; className?: string };

function node(
  ref: string,
  fields: NodeFields = {},
  parentRef?: string,
  ancestorChain: readonly string[] = [],
): IdentityNode {
  const built: IdentityNode = { ref, ancestorChain };
  if (fields.resourceId !== undefined) built.resourceId = fields.resourceId;
  if (fields.contentDesc !== undefined) built.contentDesc = fields.contentDesc;
  if (fields.className !== undefined) built.className = fields.className;
  if (parentRef !== undefined) built.parentRef = parentRef;
  return built;
}

/** Root + header/footer branches of a synthetic checkout hierarchy. */
function shellNodes(): IdentityNode[] {
  return [
    node('e1', { resourceId: 'com.shop.app:id/root', className: 'android.widget.FrameLayout' }),
    node('e2', { resourceId: 'com.shop.app:id/header', className: 'android.widget.LinearLayout' }, 'e1', ['e1']),
    node('e3', { resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button' }, 'e2', ['e1', 'e2']),
    node('e4', { resourceId: 'com.shop.app:id/footer', className: 'android.widget.LinearLayout' }, 'e1', ['e1']),
    node('e5', { resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button' }, 'e4', ['e1', 'e4']),
  ];
}

/** List branch: two identical add-to-cart buttons under one parent. */
function listNodes(): IdentityNode[] {
  return [
    node('e6', { resourceId: 'com.shop.app:id/list', className: 'android.widget.LinearLayout' }, 'e1', ['e1']),
    node('e7', { resourceId: 'com.shop.app:id/add_to_cart', className: 'android.widget.Button' }, 'e6', ['e1', 'e6']),
    node('e8', { resourceId: 'com.shop.app:id/add_to_cart', className: 'android.widget.Button' }, 'e6', ['e1', 'e6']),
  ];
}

/** Form branch: two buttons with no id of their own under one container. */
function formNodes(): IdentityNode[] {
  return [
    node('e9', { resourceId: 'com.shop.app:id/form_container', className: 'android.widget.LinearLayout' }, 'e1', ['e1']),
    node('e10', { className: 'android.widget.Button' }, 'e9', ['e1', 'e9']),
    node('e11', { className: 'android.widget.Button' }, 'e9', ['e1', 'e9']),
  ];
}

/** Small synthetic checkout hierarchy with header/footer/list/form branches. */
function checkoutNodes(): IdentityNode[] {
  return [...shellNodes(), ...listNodes(), ...formNodes()];
}

describe('deriveElementId — resourceId and contentDesc identity', () => {
  it('returns the same id for the same node on repeat derivations', () => {
    const nodes = checkoutNodes();
    const first = deriveElementId(nodes[2] as IdentityNode, SCREEN, nodes);
    const second = deriveElementId(nodes[2] as IdentityNode, SCREEN, nodes);
    expect(first).toBe('checkout.pay-now@header');
    expect(second).toBe(first);
  });

  it('derives the worked example id from a resourceId', () => {
    const nodes = [node('e1', { resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button' })];
    expect(deriveElementId(nodes[0] as IdentityNode, SCREEN, nodes)).toBe('checkout.pay-now');
  });

  it('ignores contentDesc when a resourceId is present', () => {
    const withFirstDesc = node('e1', { resourceId: 'com.shop.app:id/pay_now', contentDesc: 'Pay now', className: 'android.widget.Button' });
    const withSecondDesc = node('e1', { resourceId: 'com.shop.app:id/pay_now', contentDesc: 'Pay later', className: 'android.widget.Button' });
    const first = deriveElementId(withFirstDesc, SCREEN, [withFirstDesc]);
    const second = deriveElementId(withSecondDesc, SCREEN, [withSecondDesc]);
    expect(first).toBe('checkout.pay-now');
    expect(second).toBe(first);
  });

  it('gives different ids for the same contentDesc under different resourceIds', () => {
    const nodes = [
      node('e1', { resourceId: 'com.shop.app:id/pay_a', contentDesc: 'Pay', className: 'android.widget.Button' }),
      node('e2', { resourceId: 'com.shop.app:id/pay_b', contentDesc: 'Pay', className: 'android.widget.Button' }),
    ];
    const ids = deriveElementIds(nodes, SCREEN, nodes);
    expect(ids.get('e1')).toBe('checkout.pay-a');
    expect(ids.get('e2')).toBe('checkout.pay-b');
  });

  it('derives an id from contentDesc when no resourceId exists', () => {
    const nodes = [node('e1', { contentDesc: 'Back', className: 'android.widget.ImageButton' })];
    expect(deriveElementId(nodes[0] as IdentityNode, SCREEN, nodes)).toBe('checkout.back');
  });
});

describe('deriveElementId — repeats, insertion, and cross-parent collisions', () => {
  it('keeps other ids unchanged when an element is inserted above them', () => {
    const before = checkoutNodes();
    const beforeIds = deriveElementIds(before, SCREEN, before);
    const inserted = node('e0', { resourceId: 'com.shop.app:id/banner', className: 'android.widget.TextView' }, 'e1', ['e1']);
    const after = [before[0] as IdentityNode, inserted, ...before.slice(1)];
    const afterIds = deriveElementIds(after, SCREEN, after);
    for (const ref of ['e3', 'e5', 'e7', 'e8', 'e10', 'e11']) {
      expect(afterIds.get(ref)).toBe(beforeIds.get(ref));
    }
  });

  it('numbers repeated list items #1 and #2', () => {
    const ids = deriveElementIds(checkoutNodes(), SCREEN, checkoutNodes());
    expect(ids.get('e7')).toBe('checkout.add-to-cart#1');
    expect(ids.get('e8')).toBe('checkout.add-to-cart#2');
  });

  it('disambiguates the same resourceId under different parents with @ancestor', () => {
    const ids = deriveElementIds(checkoutNodes(), SCREEN, checkoutNodes());
    expect(ids.get('e3')).toBe('checkout.pay-now@header');
    expect(ids.get('e5')).toBe('checkout.pay-now@footer');
  });
});

describe('deriveElementId — ancestor fallback', () => {
  it('derives the fallback id from the nearest ancestor resourceId and class', () => {
    const ids = deriveElementIds(checkoutNodes(), SCREEN, checkoutNodes());
    expect(ids.get('e10')).toBe('checkout.form-container-button#1');
    expect(ids.get('e11')).toBe('checkout.form-container-button#2');
  });

  it('fails loudly when no ancestor carries a resourceId', () => {
    const nodes = [
      node('e1', { className: 'android.widget.FrameLayout' }),
      node('e2', { className: 'android.widget.Button' }, 'e1', ['e1']),
    ];
    const target = nodes[1] as IdentityNode;
    expect(() => deriveElementIds([target], SCREEN, nodes)).toThrow(ElementIdentityError);
    try {
      deriveElementIds([target], SCREEN, nodes);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ElementIdentityError);
      expect((error as ElementIdentityError).code).toBe('ELEMENT_IDENTITY');
      expect((error as ElementIdentityError).context.ref).toBe('e2');
    }
  });

  it('still identifies a target when an unrelated context node has no anchor', () => {
    const nodes = [
      node('e1', { className: 'android.widget.FrameLayout' }),
      node('e2', { resourceId: 'com.shop.app:id/pay_now', className: 'android.widget.Button' }, 'e1', ['e1']),
    ];
    const ids = deriveElementIds([nodes[1] as IdentityNode], SCREEN, nodes);
    expect(ids.get('e2')).toBe('checkout.pay-now');
  });
});

describe('deriveElementId — truncation', () => {
  it('truncates a long slug at a word boundary with a hash suffix', () => {
    const long = 'a-very-long-resource-id-segment-that-keeps-going-and-going-forever';
    const nodes = [node('e1', { resourceId: `com.shop.app:id/${long}`, className: 'android.widget.Button' })];
    const id = deriveElementId(nodes[0] as IdentityNode, SCREEN, nodes);
    const slug = id.slice('checkout.'.length);
    expect(slug.length).toBeLessThanOrEqual(MAX_ELEMENT_SLUG_LENGTH + 1 + 6);
    expect(slug).toMatch(/-[0-9a-f]{6}$/);
    const expectedHash = createHash('sha256').update(long).digest('hex').slice(0, 6);
    expect(slug.endsWith(`-${expectedHash}`)).toBe(true);
    expect(slug.startsWith('a-very-long-resource-id-segment-that-keeps')).toBe(true);
  });

  it('truncates at exactly 50 characters when no word boundary exists', () => {
    const long = 'a'.repeat(80);
    const nodes = [node('e1', { resourceId: `com.shop.app:id/${long}`, className: 'android.widget.Button' })];
    const id = deriveElementId(nodes[0] as IdentityNode, SCREEN, nodes);
    const slug = id.slice('checkout.'.length);
    expect(slug).toBe(`${'a'.repeat(50)}-${createHash('sha256').update(long).digest('hex').slice(0, 6)}`);
  });
});
