import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppiumXCUITestDriver } from '../appiumXCUITestDriver.js';

afterEach(() => vi.unstubAllGlobals());

describe('AppiumXCUITestDriver lifecycle actions', () => {
  it('uses Appium device endpoints for keyboard and app lifecycle actions', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      const value = url.endsWith('/session') ? { sessionId: 'ios-session' } : null;
      return new Response(JSON.stringify({ value }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const driver = new AppiumXCUITestDriver();
    await driver.connect({ platform: 'ios', appId: 'com.example.app', metadata: { deviceName: 'iPhone 16' } });
    await driver.perform({ type: 'hideKeyboard' });
    await driver.perform({ type: 'launchApp' });
    await driver.perform({ type: 'terminateApp' });
    await driver.disconnect();

    expect(requests.map((request) => request.url)).toEqual([
      'http://127.0.0.1:4723/session',
      'http://127.0.0.1:4723/session/ios-session/appium/device/hide_keyboard',
      'http://127.0.0.1:4723/session/ios-session/appium/device/activate_app',
      'http://127.0.0.1:4723/session/ios-session/appium/device/terminate_app',
      'http://127.0.0.1:4723/session/ios-session'
    ]);
    expect(JSON.parse(requests[2]?.body ?? '{}')).toEqual({ bundleId: 'com.example.app' });
    expect(JSON.parse(requests[3]?.body ?? '{}')).toEqual({ bundleId: 'com.example.app' });
  });

  it('rejects malformed bundle identifiers before opening an Appium session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const driver = new AppiumXCUITestDriver();
    await expect(driver.connect({ platform: 'ios', appId: 'com.example;bad' })).rejects.toMatchObject({ code: 'INVALID_SPEC' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
