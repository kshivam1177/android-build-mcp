import { describe, expect, it, vi } from 'vitest';
import type { AutomationBackend } from '../../../automation/backend.js';
import { AndroidAdbDriver } from '../adbDriver.js';

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
    expect(mock.tap).toHaveBeenCalledWith('emulator-5554', 60, 45);
    await driver.disconnect();
  });

  it('dismisses the Android keyboard through the native back key event', async () => {
    const mock = backend();
    const driver = new AndroidAdbDriver(mock);
    await driver.connect({ platform: 'android', targetId: 'emulator-5554' });
    const result = await driver.perform({ type: 'hideKeyboard' });
    expect(result.dispatched).toBe(true);
    expect(mock.keyEvent).toHaveBeenCalledWith('emulator-5554', 'KEYCODE_BACK');
    await driver.disconnect();
  });

  it('rejects missing Android target configuration', async () => {
    const driver = new AndroidAdbDriver(backend());
    await expect(driver.connect({ platform: 'android' })).rejects.toMatchObject({ code: 'INVALID_SPEC' });
  });
});
