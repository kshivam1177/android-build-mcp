import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isRecording, recordAction, startRecording, stopRecording } from '../recorder.js';

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('UI action recorder', () => {
  it('persists actions and screenshots metadata in a versioned recording', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-recorder-'));
    await startRecording({ flowId: 'login-flow', deviceId: 'device-1', projectRoot: root });
    expect(isRecording('device-1')).toBe(true);
    recordAction({
      type: 'tap', durationMs: 12, coordinates: { x: 10, y: 20 },
      normalizedCoordinates: { x: 0.1, y: 0.2 }, screenSize: { width: 100, height: 100 },
    });
    const saved = await stopRecording();
    expect(saved.actionCount).toBe(1);
    expect(isRecording()).toBe(false);
    expect(saved.recordingPath).toBe('.testorbit/android/recordings/login-flow.json');
    const contents = JSON.parse(await readFile(path.join(root, '.testorbit', 'android', 'recordings', 'login-flow.json'), 'utf8'));
    expect(contents.schemaVersion).toBe(2);
    expect(contents.platform).toBe('android');
    expect(contents.actions[0].type).toBe('tap');
    expect(contents.actions[0].normalizedCoordinates).toEqual({ x: 0.1, y: 0.2 });
  });

  it('writes v2 recordings under the recording platform folder with per-action ids', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-recorder-'));
    await startRecording({ flowId: 'ios-flow', deviceId: 'device-1', projectRoot: root, platform: 'ios' });
    recordAction({
      type: 'tap', durationMs: 12, coordinates: { x: 10, y: 20 },
      screenId: 'checkout', variantId: 'checkout.online-card', elementId: 'checkout.pay',
      isNavigationStep: true,
    });
    recordAction({
      type: 'key_press', durationMs: 1, keyCode: 'KEYCODE_BACK',
      detectionNote: 'hierarchy dump failed: device offline',
    });
    const saved = await stopRecording();
    expect(saved.recordingPath).toBe('.testorbit/ios/recordings/ios-flow.json');
    const contents = JSON.parse(await readFile(path.join(root, '.testorbit', 'ios', 'recordings', 'ios-flow.json'), 'utf8'));
    expect(contents.schemaVersion).toBe(2);
    expect(contents.platform).toBe('ios');
    expect(contents.actions[0].screenId).toBe('checkout');
    expect(contents.actions[0].variantId).toBe('checkout.online-card');
    expect(contents.actions[0].elementId).toBe('checkout.pay');
    expect(contents.actions[0].isNavigationStep).toBe(true);
    expect(contents.actions[1].detectionNote).toMatch(/hierarchy dump failed/);
  });

  it('redacts typed text when configured and auto-redacts password-like selectors', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-recorder-'));
    await startRecording({ flowId: 'private-flow', deviceId: 'device-1', projectRoot: root, redactText: true });
    recordAction({ type: 'type_text', durationMs: 1, text: 'secret-value' });
    recordAction({ type: 'tap', durationMs: 1, selector: { resourceId: 'password_field' } });
    recordAction({ type: 'type_text', durationMs: 1, text: 'secret-value' });
    await stopRecording();
    const contents = JSON.parse(await readFile(path.join(root, '.testorbit', 'android', 'recordings', 'private-flow.json'), 'utf8'));
    expect(contents.actions[0].redacted).toBe(true);
    expect(contents.actions[0].text).toBeUndefined();
    expect(contents.actions[2].redacted).toBe(true);
  });

  it('rejects concurrent recordings and never overwrites an existing flow id', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-recorder-'));
    await startRecording({ flowId: 'one', deviceId: 'device-1', projectRoot: root });
    await expect(startRecording({ flowId: 'two', deviceId: 'device-1', projectRoot: root })).rejects.toThrow(/already active/);
    recordAction({ type: 'key_press', durationMs: 1, keyCode: 'KEYCODE_BACK' });
    await stopRecording();
    await expect(startRecording({ flowId: 'one', deviceId: 'device-1', projectRoot: root })).rejects.toThrow(/already exists/);
  });

  it('rejects unsafe flow ids', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amf-recorder-'));
    await expect(startRecording({ flowId: '../escape', deviceId: 'device-1', projectRoot: root })).rejects.toThrow(/flowId/);
  });
});
