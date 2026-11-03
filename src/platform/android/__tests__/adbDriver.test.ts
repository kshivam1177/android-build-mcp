import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationBackend } from '../../../automation/backend.js';
import { AndroidAdbDriver } from '../adbDriver.js';
import { runAdbShell } from '../../../utils/adb.js';

vi.mock('../../../utils/adb.js', () => ({
  runAdbShell: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, command: 'adb', durationMs: 0 }))
}));

beforeEach(() => vi.clearAllMocks());

function backend(): AutomationBackend {
  return {
    name: 'adb',
    isAvailable: vi.fn(async () => true),
    dumpHierarchy: vi.fn(async () => '<hierarchy><node index="0" text="Continue" resource-id="app:id/continue" class="android.widget.Button" bounds="[10,20][110,70]" clickable="true" enabled="true" /></hierarchy>'),
    tap: vi.fn(async () => undefined),
    longPress: vi.fn(async () => undefined),
    swipe: vi.fn(async () => undefined),
    drag: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    keyEvent: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => ({ data: Buffer.from('png'), mimeType: 'image/png' }))
  };
}

describe('AndroidAdbDriver', () => {
  it('creates generation-scoped accessibility snapshots', async () => {
    const driver = new AndroidAdbDriver(backend());
    await driver.connect({ platform: 'android', targetId: 'emulator-5554' });
    const first = await driver.snapshot();
    const second = await driver.snapshot();
    expect(first.generation).toBe(1);
    expect(second.generation).toBe(2);
    expect(first.nodes[0]?.resourceId).toBe('app:id/continue');
    await driver.disconnect();
  });

  it('resolves semantic selectors against a fresh snapshot before tapping', async () => {
    const mock = backend();
    const driver = new AndroidAdbDriver(mock);
    await driver.connect({ platform: 'android', targetId: 'emulator-5554' });
    const result = await driver.perform({ type: 'tap', selector: { strategy: 'resourceId', value: 'app:id/continue' } });
    expect(result.dispatched).toBe(true);
    expect(mock.tap).toHaveBeenCalledWith('emulator-5554', 60, 45, undefined);
    await driver.disconnect();
  });

  it('dismisses the Android keyboard through the native back key event', async () => {
    const mock = backend();
    const driver = new AndroidAdbDriver(mock);
    await driver.connect({ platform: 'android', targetId: 'emulator-5554' });
    vi.mocked(runAdbShell).mockResolvedValueOnce({ stdout: 'mInputShown=true', stderr: '', exitCode: 0, command: 'adb', durationMs: 1 });
    const result = await driver.perform({ type: 'hideKeyboard' });
    expect(result.dispatched).toBe(true);
    expect(mock.keyEvent).toHaveBeenCalledWith('emulator-5554', 'KEYCODE_BACK', undefined);
    await driver.disconnect();
  });

  it('does not send BACK when Android reports that the keyboard is hidden', async () => {
    const mock = backend();
    const driver = new AndroidAdbDriver(mock);
    await driver.connect({ platform: 'android', targetId: 'emulator-5554' });
    const result = await driver.perform({ type: 'hideKeyboard' });
    expect(result.dispatched).toBe(false);
    expect(mock.keyEvent).not.toHaveBeenCalled();
    await driver.disconnect();
  });

  it('launches and terminates only the configured package through ADB', async () => {
    const driver = new AndroidAdbDriver(backend());
    await driver.connect({ platform: 'android', targetId: 'emulator-5554', appId: 'com.example.app' });
    await driver.perform({ type: 'terminateApp' });
    expect(runAdbShell).toHaveBeenCalledWith('emulator-5554', ['am', 'force-stop', 'com.example.app'], { timeoutMs: 10000, signal: undefined });
    await driver.perform({ type: 'launchApp' });
    expect(runAdbShell).toHaveBeenCalledWith('emulator-5554', ['monkey', '-p', 'com.example.app', '-c', 'android.intent.category.LAUNCHER', '1'], { timeoutMs: 15000, signal: undefined });
    await driver.disconnect();
  });

  it('rejects malformed app identifiers before native command dispatch', async () => {
    const driver = new AndroidAdbDriver(backend());
    await expect(driver.connect({ platform: 'android', targetId: 'emulator-5554', appId: 'com.example; rm -rf /' }))
      .rejects.toMatchObject({ code: 'INVALID_SPEC' });
    await driver.connect({ platform: 'android', targetId: 'emulator-5554' });
    await expect(driver.perform({ type: 'launchApp', appId: 'com.example;bad' }))
      .rejects.toMatchObject({ code: 'INVALID_SPEC' });
    expect(runAdbShell).not.toHaveBeenCalled();
    await driver.disconnect();
  });

  it('forwards cancellation signals to native backend calls', async () => {
    const mock = backend();
    const driver = new AndroidAdbDriver(mock);
    const controller = new AbortController();
    await driver.connect({ platform: 'android', targetId: 'emulator-5554' });
    await driver.snapshot(controller.signal);
    expect(mock.dumpHierarchy).toHaveBeenCalledWith('emulator-5554', controller.signal);
    await driver.perform({ type: 'tap', selector: { strategy: 'resourceId', value: 'app:id/continue' } }, controller.signal);
    expect(mock.tap).toHaveBeenCalledWith('emulator-5554', 60, 45, controller.signal);
    await driver.disconnect();
  });

  it('rejects missing Android target configuration', async () => {
    const driver = new AndroidAdbDriver(backend());
    await expect(driver.connect({ platform: 'android' })).rejects.toMatchObject({ code: 'INVALID_SPEC' });
  });
});
