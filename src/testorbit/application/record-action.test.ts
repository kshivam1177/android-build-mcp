/**
 * RecordingDetector tests (Phase 5, B8) — detection around recorded
 * actions, proved with fixture hierarchies and a scripted dump
 * provider. No device, no pilot app: the dumps are the `variants.ts`
 * fixtures (test data for pure logic only, never flows).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DetectVariantUseCase } from './detect-variant.js';
import { RecordingDetector, UNKNOWN_VARIANT_ID } from './record-action.js';
import type { RecordDetection } from './record-action.js';
import type { DisplaySize } from '../core/screen-identity.js';
import type { CoreHierarchyNode } from '../domain/types.js';
import { toScreenId } from '../domain/types.js';
import type { HierarchyProvider } from '../infrastructure/hierarchy-provider.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import {
  DISPLAY,
  freshCheckoutCard,
  freshLoginOtp,
  writeFixtureScreenTree,
} from '../test-fixtures/variants.js';

/** Hierarchy provider returning one scripted dump per call, in order. */
class ScriptedProvider implements HierarchyProvider {
  private index = 0;
  /**
   * @param dumps - Dump per call; the last dump repeats when exhausted.
   */
  constructor(private readonly dumps: readonly (readonly CoreHierarchyNode[])[]) {}

  /** @returns The next scripted dump. */
  async dumpHierarchy(): Promise<readonly CoreHierarchyNode[]> {
    const dump = this.dumps[Math.min(this.index, this.dumps.length - 1)] ?? [];
    this.index += 1;
    return dump;
  }

  /** @returns The fixture display size. */
  async displaySize(): Promise<DisplaySize> {
    return DISPLAY;
  }
}

/** Hierarchy provider whose dump always fails (device unavailable). */
class ThrowingProvider implements HierarchyProvider {
  /** @throws Always — the dump cannot be supplied. */
  async dumpHierarchy(): Promise<readonly CoreHierarchyNode[]> {
    throw new Error('adb: device offline');
  }

  /** @returns The fixture display size. */
  async displaySize(): Promise<DisplaySize> {
    return DISPLAY;
  }
}

/** One hierarchy node for an unlearned element, on screen. */
function unknownNode(): CoreHierarchyNode {
  return {
    ref: 'e1',
    resourceId: 'com.shop.app:id/never_learned',
    bounds: { left: 10, top: 20, right: 110, bottom: 70 },
    clickable: true,
    enabled: true,
  };
}

/** Temp project with checkout + login learned, plus a detector. */
function makeDetector(
  provider: HierarchyProvider,
  withScreens = true,
): { projectRoot: string; detector: RecordingDetector } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-record-'));
  if (withScreens) {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  }
  const store = new VariantStore(projectRoot, 'android');
  const detector = new RecordingDetector({
    useCase: new DetectVariantUseCase(store),
    provider,
    store,
    projectRoot,
    platform: 'android',
  });
  return { projectRoot, detector };
}

describe('RecordingDetector — matched actions', () => {
  let projectRoot: string;
  let detector: RecordingDetector;

  beforeEach(() => {
    ({ projectRoot, detector } = makeDetector(new ScriptedProvider([freshCheckoutCard()])));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('records the pre-action screen+variant+elementId on a known screen', async () => {
    const before = await detector.detectCurrent();
    const annotation = await detector.annotateAction(before, { resourceId: 'com.shop.app:id/card_number' });
    expect(annotation.screenId).toBe('checkout');
    expect(annotation.variantId).toBe('checkout.online-card');
    expect(annotation.elementId).toBe('checkout.card-number');
    expect(annotation.isNavigationStep).toBe(false);
    expect(annotation.detectionNote).toBeUndefined();
  });

  it('records no element id for actions without a target element', async () => {
    const before = await detector.detectCurrent();
    const annotation = await detector.annotateAction(before);
    expect(annotation.screenId).toBe('checkout');
    expect(annotation.variantId).toBe('checkout.online-card');
    expect(annotation.elementId).toBeUndefined();
    expect(annotation.isNavigationStep).toBe(false);
  });

  it('records no element id when the selector matches nothing learned', async () => {
    const before = await detector.detectCurrent();
    const annotation = await detector.annotateAction(before, { resourceId: 'com.shop.app:id/nope' });
    expect(annotation.screenId).toBe('checkout');
    expect(annotation.elementId).toBeUndefined();
  });

  it('records no element id when the selector matches many elements', async () => {
    const before = await detector.detectCurrent();
    const annotation = await detector.annotateAction(before, { className: 'android.widget.Button' });
    expect(annotation.screenId).toBe('checkout');
    expect(annotation.elementId).toBeUndefined();
  });
});

describe('RecordingDetector — navigation steps', () => {
  let projectRoot: string;
  let detector: RecordingDetector;

  beforeEach(() => {
    const dumps = [freshCheckoutCard(), freshCheckoutCard(), freshCheckoutCard(), freshLoginOtp()];
    ({ projectRoot, detector } = makeDetector(new ScriptedProvider(dumps)));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('marks the change at the right action across two screens', async () => {
    const firstBefore = await detector.detectCurrent();
    const first = await detector.annotateAction(firstBefore, { resourceId: 'com.shop.app:id/card_number' });
    expect(first.screenId).toBe('checkout');
    expect(first.isNavigationStep).toBe(false);
    const secondBefore = await detector.detectCurrent();
    const second = await detector.annotateAction(secondBefore, { resourceId: 'com.shop.app:id/cod_option' });
    expect(second.screenId).toBe('checkout');
    expect(second.variantId).toBe('checkout.online-card');
    expect(second.elementId).toBe('checkout.cod-option');
    expect(second.isNavigationStep).toBe(true);
  });
});

describe('RecordingDetector — unknown and unavailable', () => {
  let projectRoot: string;

  afterEach(() => {
    if (projectRoot !== undefined) fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('records variantId unknown with evidence when no screen matches', async () => {
    let detector: RecordingDetector;
    ({ projectRoot, detector } = makeDetector(new ScriptedProvider([[unknownNode()]])));
    const before = await detector.detectCurrent();
    expect(before.status).toBe('unknown');
    const annotation = await detector.annotateAction(before, { resourceId: 'com.shop.app:id/never_learned' });
    expect(annotation.screenId).toBeUndefined();
    expect(annotation.variantId).toBe(UNKNOWN_VARIANT_ID);
    expect(annotation.isNavigationStep).toBe(false);
    expect(annotation.detectionNote).toMatch(/checkout|login/);
  });

  it('records no ids and a note when the dump fails', async () => {
    let detector: RecordingDetector;
    ({ projectRoot, detector } = makeDetector(new ThrowingProvider()));
    const before = await detector.detectCurrent();
    expect(before.status).toBe('unavailable');
    const annotation = await detector.annotateAction(before);
    expect(annotation.screenId).toBeUndefined();
    expect(annotation.variantId).toBeUndefined();
    expect(annotation.isNavigationStep).toBe(false);
    expect(annotation.detectionNote).toMatch(/hierarchy dump failed/);
  });

  it('records no ids and a note when no screens are learned yet', async () => {
    let detector: RecordingDetector;
    ({ projectRoot, detector } = makeDetector(new ScriptedProvider([freshCheckoutCard()]), false));
    const before = await detector.detectCurrent();
    expect(before.status).toBe('unavailable');
    const annotation = await detector.annotateAction(before);
    expect(annotation.screenId).toBeUndefined();
    expect(annotation.detectionNote).toMatch(/No screens are learned/);
  });

  it('never throws from detectCurrent when identification fails', async () => {
    let detector: RecordingDetector;
    ({ projectRoot, detector } = makeDetector(new ThrowingProvider()));
    let detection: RecordDetection | undefined;
    await expect((async () => {
      detection = await detector.detectCurrent();
    })()).resolves.not.toThrow();
    expect(detection?.status).toBe('unavailable');
  });
});
