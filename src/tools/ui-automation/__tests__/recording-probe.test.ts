/**
 * Recording-probe tests (Phase 5, B8) — the handler-side glue, proved
 * without a device: a fake backend that must never be touched when no
 * recording is active, and a scripted dump provider behind a real
 * `RecordingDetector` for the annotation path. Fixture hierarchies
 * only — never flows, never a stand-in for a real app.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationBackend } from '../../../automation/backend.js';
import { isRecording, recordAction, startRecording, stopRecording } from '../../../automation/recorder.js';
import { DetectVariantUseCase } from '../../../testorbit/application/detect-variant.js';
import { RecordingDetector } from '../../../testorbit/application/record-action.js';
import type { DisplaySize } from '../../../testorbit/core/screen-identity.js';
import type { CoreHierarchyNode } from '../../../testorbit/domain/types.js';
import { toScreenId } from '../../../testorbit/domain/types.js';
import type { HierarchyProvider } from '../../../testorbit/infrastructure/hierarchy-provider.js';
import { VariantStore } from '../../../testorbit/infrastructure/variant-store.js';
import { DISPLAY, freshCheckoutCard, writeFixtureScreenTree } from '../../../testorbit/test-fixtures/variants.js';
import { finishRecordingProbe, startRecordingProbe } from '../recording-probe.js';

/**
 * Stub only the adb shell lookup (screen size) so the Android probe
 * path runs without a device; every other adb helper stays original.
 * The hierarchy itself still comes from the fake backend's XML.
 */
vi.mock('../../../utils/adb.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../utils/adb.js')>();
  return {
    ...original,
    runAdbShell: async () => ({ stdout: 'Physical size: 1080x2400\n', stderr: '', exitCode: 0, durationMs: 1 }),
  };
});

/** Backend whose dump must never be called (fails the test if it is). */
const untouchedBackend = {
  name: 'adb',
  dumpHierarchy: async (): Promise<string> => {
    throw new Error('backend must not be touched');
  },
} as unknown as AutomationBackend;

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

let root: string | undefined;

/** Serialise fixture nodes to uiautomator XML the Android provider parses. */
function nodesToXml(nodes: readonly CoreHierarchyNode[]): string {
  const inner = nodes
    .map((node, index) => {
      const bounds = `[${node.bounds.left},${node.bounds.top}][${node.bounds.right},${node.bounds.bottom}]`;
      return `<node index="${index}" resource-id="${node.resourceId ?? ''}" class="android.widget.Button" clickable="${node.clickable}" enabled="${node.enabled}" bounds="${bounds}"></node>`;
    })
    .join('');
  return `<hierarchy><node index="0" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">${inner}</node></hierarchy>`;
}

/** Backend returning one canned hierarchy XML dump. */
function xmlBackend(xml: string): AutomationBackend {
  return {
    name: 'adb',
    dumpHierarchy: async (): Promise<string> => xml,
  } as unknown as AutomationBackend;
}

/** Stop any leaked recording, then remove the temp root. */
async function cleanup(): Promise<void> {
  try {
    if (isRecording()) await stopRecording();
  } catch {
    // No active recording to stop.
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
}

afterEach(async () => {
  await cleanup();
});

/** Read one stopped recording's JSON from its platform folder. */
async function readRecording(platform: string, flowId: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path.join(root as string, '.testorbit', platform, 'recordings', `${flowId}.json`), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('recording probe', () => {
  it('is inert without an active recording and never touches the backend', async () => {
    const probe = await startRecordingProbe(untouchedBackend, 'device-1');
    expect(probe.detector).toBeNull();
    expect(probe.before).toBeNull();
    await finishRecordingProbe(probe, 'device-1', { type: 'tap', durationMs: 1 });
    expect(isRecording()).toBe(false);
  });

  it('records without ids and an explicit note on a platform with no provider', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-probe-'));
    await startRecording({ flowId: 'ios-flow', deviceId: 'device-1', projectRoot: root, platform: 'ios' });
    const probe = await startRecordingProbe(untouchedBackend, 'device-1');
    expect(probe.detector).toBeNull();
    expect(probe.unavailableReason).toMatch(/not wired for platform "ios"/);
    await finishRecordingProbe(probe, 'device-1', { type: 'swipe', durationMs: 3 });
    await stopRecording();
    const contents = await readRecording('ios', 'ios-flow');
    expect(contents['schemaVersion']).toBe(2);
    const actions = contents['actions'] as Record<string, unknown>[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.['screenId']).toBeUndefined();
    expect(actions[0]?.['variantId']).toBeUndefined();
    expect(actions[0]?.['detectionNote']).toMatch(/not wired for platform "ios"/);
  });

  it('records the annotated action through the probe on android', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-probe-'));
    writeFixtureScreenTree(root, 'android', toScreenId('checkout'));
    writeFixtureScreenTree(root, 'android', toScreenId('login'));
    const store = new VariantStore(root, 'android');
    const detector = new RecordingDetector({
      useCase: new DetectVariantUseCase(store),
      provider: new ScriptedProvider([freshCheckoutCard(), freshCheckoutCard()]),
      store,
      projectRoot: root,
      platform: 'android',
    });
    await startRecording({ flowId: 'android-flow', deviceId: 'device-1', projectRoot: root, platform: 'android' });
    const before = await detector.detectCurrent();
    await finishRecordingProbe(
      { detector, before },
      'device-1',
      { type: 'tap', durationMs: 5, selector: { resourceId: 'com.shop.app:id/pay' } },
      { resourceId: 'com.shop.app:id/pay' },
    );
    await stopRecording();
    const contents = await readRecording('android', 'android-flow');
    const actions = contents['actions'] as Record<string, unknown>[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.['screenId']).toBe('checkout');
    expect(actions[0]?.['variantId']).toBe('checkout.online-card');
    expect(actions[0]?.['elementId']).toBe('checkout.pay');
    expect(actions[0]?.['isNavigationStep']).toBe(false);
  });

  it('builds the android detector from the backend dump and records annotated', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-probe-'));
    writeFixtureScreenTree(root, 'android', toScreenId('checkout'));
    writeFixtureScreenTree(root, 'android', toScreenId('login'));
    await startRecording({ flowId: 'android-live-flow', deviceId: 'device-1', projectRoot: root, platform: 'android' });
    const probe = await startRecordingProbe(xmlBackend(nodesToXml(freshCheckoutCard())), 'device-1');
    expect(probe.detector).not.toBeNull();
    expect(probe.before?.status).toBe('matched');
    await finishRecordingProbe(
      probe,
      'device-1',
      { type: 'tap', durationMs: 5, selector: { resourceId: 'com.shop.app:id/pay' } },
      { resourceId: 'com.shop.app:id/pay' },
    );
    await stopRecording();
    const contents = await readRecording('android', 'android-live-flow');
    const actions = contents['actions'] as Record<string, unknown>[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.['screenId']).toBe('checkout');
    expect(actions[0]?.['variantId']).toBe('checkout.online-card');
    expect(actions[0]?.['elementId']).toBe('checkout.pay');
    expect(actions[0]?.['isNavigationStep']).toBe(false);
  });

  it('records a plain action when the probe carries neither a detector nor a reason', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-probe-'));
    await startRecording({ flowId: 'bare-probe-flow', deviceId: 'device-1', projectRoot: root, platform: 'android' });
    await finishRecordingProbe({ detector: null, before: null }, 'device-1', { type: 'key_press', durationMs: 1, keyCode: 'KEYCODE_BACK' });
    await stopRecording();
    const contents = await readRecording('android', 'bare-probe-flow');
    const actions = contents['actions'] as Record<string, unknown>[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.['type']).toBe('key_press');
    expect(actions[0]?.['detectionNote']).toBeUndefined();
  });

  it('records an explicit note when the detector exists but no pre-action snapshot was captured', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-probe-'));
    writeFixtureScreenTree(root, 'android', toScreenId('checkout'));
    const store = new VariantStore(root, 'android');
    const detector = new RecordingDetector({
      useCase: new DetectVariantUseCase(store),
      provider: new ScriptedProvider([freshCheckoutCard()]),
      store,
      projectRoot: root,
      platform: 'android',
    });
    await startRecording({ flowId: 'missing-before-flow', deviceId: 'device-1', projectRoot: root, platform: 'android' });
    await finishRecordingProbe({ detector, before: null }, 'device-1', { type: 'tap', durationMs: 1 });
    await stopRecording();
    const contents = await readRecording('android', 'missing-before-flow');
    const actions = contents['actions'] as Record<string, unknown>[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.['screenId']).toBeUndefined();
    expect(actions[0]?.['detectionNote']).toMatch(/pre-action detection was not captured/);
  });

  it('finish is a no-op after the recording stopped', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-probe-'));
    await startRecording({ flowId: 'short-flow', deviceId: 'device-1', projectRoot: root });
    recordAction({ type: 'key_press', durationMs: 1, keyCode: 'KEYCODE_BACK' });
    const saved = await stopRecording();
    expect(saved.actionCount).toBe(1);
    await finishRecordingProbe({ detector: null, before: null }, 'device-1', { type: 'tap', durationMs: 1 });
    expect(isRecording()).toBe(false);
  });
});
