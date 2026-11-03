import type { PlatformDriver, PlatformKind } from './contracts.js';
import { AndroidAdbDriver } from './android/adbDriver.js';
import { FlutterSemanticsDriver } from './flutter/semanticsDriver.js';
import { AppiumXCUITestDriver } from './ios/appiumXCUITestDriver.js';
import { AgentBrowserDriver } from './web/agentBrowserDriver.js';

export type PlatformDriverOverrides = Partial<Record<PlatformKind, PlatformDriver>>;

/** Construct the supported first-party adapters; external runtimes are checked when connect is called. */
export function createPlatformDrivers(overrides: PlatformDriverOverrides = {}): Record<PlatformKind, PlatformDriver> {
  return {
    android: overrides.android ?? new AndroidAdbDriver(),
    flutter: overrides.flutter ?? new FlutterSemanticsDriver(),
    ios: overrides.ios ?? new AppiumXCUITestDriver(),
    web: overrides.web ?? new AgentBrowserDriver()
  };
}
