import { describe, expect, it } from 'vitest';
import { WebDriverAgentHierarchyProvider, parseWdaSource } from './ios-hierarchy-provider.js';
import { TestOrbitError } from '../domain/errors.js';

/**
 * Realistic WebDriverAgent `/source?format=json` payload (fixture JSON
 * only — no live WDA on this VM). One app root, one window, a pay
 * button, a card-number field, a static total label, and one invisible
 * button that must count as absent under the B6 present rule.
 */
const WDA_SOURCE = {
  value: {
    type: 'XCUIElementTypeApplication',
    name: 'ShopApp',
    label: 'ShopApp',
    enabled: true,
    visible: true,
    accessible: true,
    rect: { x: 0, y: 0, width: 390, height: 844 },
    children: [
      {
        type: 'XCUIElementTypeWindow',
        enabled: true,
        visible: true,
        accessible: false,
        rect: { x: 0, y: 0, width: 390, height: 844 },
        children: [
          {
            type: 'XCUIElementTypeButton',
            name: 'pay_now',
            label: 'Pay now',
            enabled: true,
            visible: true,
            accessible: true,
            rect: { x: 20, y: 700, width: 350, height: 50 },
            children: [],
          },
          {
            type: 'XCUIElementTypeTextField',
            name: 'card_number',
            label: 'Card number',
            value: '',
            enabled: true,
            visible: true,
            accessible: true,
            rect: { x: 20, y: 600, width: 350, height: 44 },
            children: [],
          },
          {
            type: 'XCUIElementTypeStaticText',
            name: 'total_label',
            label: 'Total ₹499',
            enabled: true,
            visible: true,
            accessible: false,
            rect: { x: 20, y: 100, width: 200, height: 24 },
            children: [],
          },
          {
            type: 'XCUIElementTypeButton',
            name: 'hidden_action',
            label: 'Hidden',
            enabled: true,
            visible: false,
            accessible: true,
            rect: { x: 20, y: 800, width: 100, height: 30 },
            children: [],
          },
        ],
      },
    ],
  },
};

describe('parseWdaSource', () => {
  it('maps accessibility identifiers to resourceIds with real bounds', () => {
    const nodes = parseWdaSource(WDA_SOURCE);
    const pay = nodes.find((node) => node.resourceId === 'pay_now');
    expect(pay?.bounds).toEqual({ left: 20, top: 700, right: 370, bottom: 750 });
    expect(pay?.clickable).toBe(true);
    expect(pay?.contentDesc).toBe('Pay now');
    expect(pay?.className).toBe('XCUIElementTypeButton');
    expect(pay?.parentRef).toBeDefined();
    expect(pay?.ancestorChain?.length).toBe(2);
  });

  it('marks text fields focusable and static text non-clickable', () => {
    const nodes = parseWdaSource(WDA_SOURCE);
    const field = nodes.find((node) => node.resourceId === 'card_number');
    expect(field?.focusable).toBe(true);
    expect(field?.clickable).toBe(true);
    const label = nodes.find((node) => node.resourceId === 'total_label');
    expect(label?.clickable).toBe(false);
    expect(label?.text).toBe('Total ₹499');
  });

  it('gives invisible elements zero-area bounds so the present rule counts them absent', () => {
    const nodes = parseWdaSource(WDA_SOURCE);
    const hidden = nodes.find((node) => node.resourceId === 'hidden_action');
    expect(hidden?.bounds).toEqual({ left: 20, top: 800, right: 20, bottom: 800 });
  });

  it('rejects a payload with no element tree', () => {
    expect(() => parseWdaSource({ value: 'not-an-element' })).toThrow(TestOrbitError);
  });
});

describe('WebDriverAgentHierarchyProvider', () => {
  it('dumps the hierarchy through an injected fetch (no live WDA)', async () => {
    const provider = new WebDriverAgentHierarchyProvider(
      'http://127.0.0.1:8100',
      { width: 390, height: 844 },
      async (url) => {
        expect(url).toBe('http://127.0.0.1:8100/source?format=json');
        return WDA_SOURCE;
      },
    );
    const nodes = await provider.dumpHierarchy();
    expect(nodes.some((node) => node.resourceId === 'pay_now')).toBe(true);
    expect(await provider.displaySize()).toEqual({ width: 390, height: 844 });
  });

  it('reports a typed error when WebDriverAgent is unreachable', async () => {
    const provider = new WebDriverAgentHierarchyProvider(
      'http://127.0.0.1:8100',
      { width: 390, height: 844 },
      async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:8100');
      },
    );
    await expect(provider.dumpHierarchy()).rejects.toMatchObject({ code: 'WDA_UNREACHABLE' });
  });
});
