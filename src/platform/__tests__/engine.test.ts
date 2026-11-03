import { describe, expect, it, vi } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { parseAutomationTest } from '../specification.js';
import type { PlatformDriver } from '../contracts.js';

function fakeDriver(platform: 'android' | 'ios' | 'web'): PlatformDriver {
  const session = { id: `session-${platform}`, platform, targetId: platform, connectedAt: new Date().toISOString() };
  return {
    platform,
    connect: vi.fn(async () => session),
    capabilities: vi.fn(async () => ({ platform, snapshots: true, accessibilityTree: true, screenshots: true, gestures: true,
      appLifecycle: true, browserNavigation: true, nativeDialogs: true, supportedActions: ['tap', 'wait'] })),
    snapshot: vi.fn(async () => ({ platform, targetId: platform, snapshotId: 'snapshot', generation: 1, capturedAt: new Date().toISOString(), nodes: [] })),
    resolve: vi.fn(async () => { throw new Error('not used'); }),
    perform: vi.fn(async (action) => ({ action: action.type, startedAt: new Date().toISOString(), durationMs: 1, target: null, dispatched: true })),
    waitFor: vi.fn(async () => ({ platform, targetId: platform, snapshotId: 'snapshot', generation: 1, capturedAt: new Date().toISOString(), nodes: [] })),
    captureEvidence: vi.fn(async () => ({ capturedAt: new Date().toISOString() })),
    disconnect: vi.fn(async () => undefined)
  } as unknown as PlatformDriver;
}

describe('AutomationEngine', () => {
  it('runs the same deterministic test across multiple platforms and cleans sessions', async () => {
    const android = fakeDriver('android');
    const web = fakeDriver('web');
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'cross-platform', name: 'Cross-platform smoke',
      platforms: ['android', 'web'],
      steps: [
        { id: 'settle', type: 'wait', timeoutMs: 1 },
        { id: 'submit', type: 'tap', selector: { strategy: 'accessibilityId', value: 'submit' } }
      ]
    });
    const result = await new AutomationEngine({ drivers: { android, web } }).run(definition);
    expect(result.success).toBe(true);
    expect(result.platforms).toHaveLength(2);
    expect(android.disconnect).toHaveBeenCalledOnce();
    expect(web.disconnect).toHaveBeenCalledOnce();
  });

  it('isolates a platform failure and continues other targets', async () => {
    const android = fakeDriver('android');
    vi.mocked(android.perform).mockRejectedValueOnce(new Error('tap failed'));
    const web = fakeDriver('web');
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'isolated', name: 'Isolation',
      platforms: ['android', 'web'],
      steps: [{ id: 'submit', type: 'tap', selector: { strategy: 'text', value: 'Submit' } }]
    });
    const result = await new AutomationEngine({ drivers: { android, web } }).run(definition);
    expect(result.success).toBe(false);
    expect(result.platforms[0]?.success).toBe(false);
    expect(result.platforms[1]?.success).toBe(true);
  });

  it('runs waitFor through the driver condition API', async () => {
    const android = fakeDriver('android');
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'wait-for', name: 'Wait for control',
      platforms: ['android'],
      steps: [{ id: 'visible', type: 'waitFor', condition: { kind: 'visible', selector: { strategy: 'text', value: 'Ready' } }, timeoutMs: 500 }]
    });
    const result = await new AutomationEngine({ drivers: { android } }).run(definition);
    expect(result.success).toBe(true);
    expect(android.waitFor).toHaveBeenCalledOnce();
  });
});
