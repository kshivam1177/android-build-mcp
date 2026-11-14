import { describe, expect, it } from 'vitest';
import { createScreenMap } from '../screenMap.js';
import type { UiNode } from '../../types.js';

function makeNode(ref: string, overrides: Partial<UiNode> = {}): UiNode {
  const node: UiNode = {
    ref, index: 0, packageName: 'com.example.app',
    resourceId: 'com.example.app:id/submit', text: 'Continue', className: 'android.widget.Button',
    bounds: { left: 10, top: 20, right: 110, bottom: 70 },
    centerX: 60, centerY: 45, clickable: true, enabled: true, focusable: true,
    scrollable: false, checkable: false, checked: false, depth: 2,
  };
  return { ...node, ...overrides };
}

const node = makeNode('e1');

describe('createScreenMap', () => {
  it('stores stable selectors, coordinates, and a fingerprint stamp', () => {
    const options = {
      screenId: 'login', deviceId: 'emulator-5554', backend: 'adb',
      screenshotPath: '.testorbit/screen-maps/images/login.png',
      width: 120, height: 90, nodes: [node], capturedAt: '2026-10-26T00:00:00.000Z',
    };
    const map = createScreenMap(options);
    expect(map.elements[0]?.id).toBe('login.submit');
    expect(map.elements[0]?.stableSelector.resourceId).toBe('com.example.app:id/submit');
    expect(map.elements[0]?.center).toEqual({ x: 60, y: 45 });
    expect(map.elements[0]?.normalizedCoordinates).toEqual({ x: 0.5, y: 0.5 });
    expect(map.fingerprint).toBe(createScreenMap(options).fingerprint);
  });

  it('drops text from the stable selector', () => {
    const map = createScreenMap({
      screenId: 'login', deviceId: 'emulator-5554', backend: 'adb',
      screenshotPath: 'login.png', width: 120, height: 90, nodes: [node],
    });
    expect(map.elements[0]?.stableSelector).toEqual({
      resourceId: 'com.example.app:id/submit',
      className: 'android.widget.Button',
    });
  });

  it('derives the same stamp regardless of element order', () => {
    const other = makeNode('e2', { resourceId: 'com.example.app:id/cancel', text: 'Cancel' });
    const base = {
      screenId: 'login', deviceId: 'emulator-5554', backend: 'adb',
      screenshotPath: 'login.png', width: 120, height: 90,
    };
    const forward = createScreenMap({ ...base, nodes: [node, other] });
    const reversed = createScreenMap({ ...base, nodes: [other, node] });
    expect(forward.fingerprint).toBe(reversed.fingerprint);
    expect(forward.elements.map((element) => element.id)).toEqual(['login.submit', 'login.cancel']);
  });

  it('excludes non-interactive nodes from elements', () => {
    const label = makeNode('e2', {
      resourceId: undefined, text: 'Welcome', className: 'android.widget.TextView',
      clickable: false, focusable: false, checkable: false,
    });
    const map = createScreenMap({
      screenId: 'login', deviceId: 'emulator-5554', backend: 'adb',
      screenshotPath: 'login.png', width: 120, height: 90, nodes: [node, label],
    });
    expect(map.elements).toHaveLength(1);
    expect(map.elements[0]?.id).toBe('login.submit');
  });

  it('rejects unsafe screen ids and invalid dimensions', () => {
    expect(() => createScreenMap({
      screenId: '../login', deviceId: 'device', backend: 'adb', screenshotPath: 'login.png',
      width: 100, height: 100, nodes: [node],
    })).toThrow(/screenId/);
    expect(() => createScreenMap({
      screenId: 'login', deviceId: 'device', backend: 'adb', screenshotPath: 'login.png',
      width: 0, height: 100, nodes: [node],
    })).toThrow(/dimensions/);
  });
});
