import { computeFingerprintStamp } from '../testorbit/core/fingerprint.js';
import { deriveElementIds } from '../testorbit/core/element-id.js';
import { stableSelectorOf } from '../testorbit/core/matcher.js';
import { isInteractiveNode } from '../testorbit/core/screen-identity.js';
import { toScreenId } from '../testorbit/domain/types.js';
import type { StableSelector } from '../testorbit/domain/types.js';
import type { UiNode } from '../types.js';

export interface ScreenMapElement {
  id: string;
  stableSelector: StableSelector;
  bounds: UiNode['bounds'];
  center: { x: number; y: number };
  normalizedCoordinates: { x: number; y: number };
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  scrollable: boolean;
  checkable: boolean;
  checked: boolean;
  depth: number;
}

export interface ScreenMap {
  schemaVersion: 2;
  screenId: string;
  capturedAt: string;
  appPackage?: string;
  deviceId: string;
  backend: string;
  display: { width: number; height: number };
  /** Version stamp only (B4): SHA-256 of the canonical stable-selector set. Never a run-time check. */
  fingerprint: string;
  screenshot: string;
  elements: ScreenMapElement[];
}

export function createScreenMap(options: {
  screenId: string;
  deviceId: string;
  backend: string;
  screenshotPath: string;
  width: number;
  height: number;
  nodes: UiNode[];
  capturedAt?: string;
}): ScreenMap {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(options.screenId)) {
    throw new Error('screenId must be 1-80 characters and contain only letters, numbers, dot, underscore, or hyphen.');
  }
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height) || options.width <= 0 || options.height <= 0) {
    throw new Error('Screen dimensions must be positive numbers.');
  }
  // Elements are the interactive nodes only (B4 input set). Decorative
  // containers carry no stable identity and must not fail a map.
  const interactive = options.nodes.filter(isInteractiveNode);
  const ids = deriveElementIds(interactive, toScreenId(options.screenId), options.nodes);
  const elements = interactive.map((node): ScreenMapElement => {
    const id = ids.get(node.ref);
    if (id === undefined) {
      throw new Error(`No stable element id derived for node ${node.ref}; this is an internal invariant failure.`);
    }
    return {
      id,
      stableSelector: stableSelectorOf(node),
      bounds: node.bounds,
      center: { x: node.centerX, y: node.centerY },
      normalizedCoordinates: {
        x: Number((node.centerX / options.width).toFixed(6)),
        y: Number((node.centerY / options.height).toFixed(6)),
      },
      clickable: node.clickable,
      enabled: node.enabled,
      focusable: node.focusable,
      scrollable: node.scrollable,
      checkable: node.checkable,
      checked: node.checked,
      depth: node.depth,
    };
  });
  return {
    schemaVersion: 2,
    screenId: options.screenId,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    ...(options.nodes.find((node) => node.packageName)?.packageName
      ? { appPackage: options.nodes.find((node) => node.packageName)?.packageName }
      : {}),
    deviceId: options.deviceId,
    backend: options.backend,
    display: { width: options.width, height: options.height },
    fingerprint: computeFingerprintStamp(elements.map((element) => element.stableSelector)),
    screenshot: options.screenshotPath,
    elements,
  };
}
