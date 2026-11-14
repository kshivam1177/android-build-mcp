import { describe, expect, it } from 'vitest';
import { parsePatrolTree } from './flutter-tree-reader.js';
import { TestOrbitError } from '../domain/errors.js';

/**
 * Fixture Patrol semantics dump (JSON only — no Flutter SDK / Patrol on
 * this VM). The harness `integration_test/testorbit_tree_dump_test.dart`
 * produces this shape: `key` is the widget's `ValueKey`, `label` the
 * `Semantics` label, `flags` the semantics flags.
 */
const PATROL_TREE = {
  type: 'Scaffold',
  rect: { left: 0, top: 0, right: 390, bottom: 844 },
  flags: { enabled: true },
  children: [
    {
      key: 'card_number',
      label: 'Card number',
      type: 'TextField',
      rect: { left: 20, top: 600, right: 370, bottom: 644 },
      flags: { textField: true, enabled: true, focusable: true },
      children: [],
    },
    {
      key: 'pay_now',
      label: 'Pay now',
      rect: { left: 20, top: 700, right: 370, bottom: 750 },
      flags: { button: true, enabled: true },
      children: [],
    },
    {
      label: 'Total ₹499',
      rect: { left: 20, top: 100, right: 220, bottom: 124 },
      flags: { enabled: true },
      children: [],
    },
  ],
};

describe('parsePatrolTree', () => {
  it('maps ValueKeys to resourceIds and Semantics labels to contentDescs', () => {
    const nodes = parsePatrolTree(PATROL_TREE);
    const pay = nodes.find((node) => node.resourceId === 'pay_now');
    expect(pay?.contentDesc).toBe('Pay now');
    expect(pay?.clickable).toBe(true);
    expect(pay?.bounds).toEqual({ left: 20, top: 700, right: 370, bottom: 750 });
    expect(pay?.parentRef).toBe(nodes[0]?.ref);
    expect(pay?.ancestorChain).toEqual([nodes[0]?.ref]);
    const field = nodes.find((node) => node.resourceId === 'card_number');
    expect(field?.className).toBe('TextField');
    expect(field?.focusable).toBe(true);
  });

  it('keeps unlabeled nodes without inventing an id for them', () => {
    const nodes = parsePatrolTree(PATROL_TREE);
    const label = nodes.find((node) => node.contentDesc === 'Total ₹499');
    expect(label?.resourceId).toBeUndefined();
    expect(label?.clickable).toBe(false);
  });

  it('rejects a dump that is not a semantics node', () => {
    expect(() => parsePatrolTree({ nope: true })).toThrow(TestOrbitError);
  });
});
