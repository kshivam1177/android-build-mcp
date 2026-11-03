import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AutomationEngine } from '../engine.js';
import { parseAutomationTest } from '../specification.js';
import type { PlatformDriver } from '../contracts.js';

function fakeDriver(platform: 'android' | 'ios' | 'web'): PlatformDriver {
  const session = { id: 'session-' + platform, platform, targetId: platform, connectedAt: new Date().toISOString() };
  return {
    platform,
    connect: vi.fn(async () => session),
    capabilities: vi.fn(async () => ({ platform, snapshots: true, accessibilityTree: true, screenshots: true, gestures: true,
      appLifecycle: true, browserNavigation: true, nativeDialogs: true, supportedActions: ['tap', 'wait'] })),
    snapshot: vi.fn(async () => ({ platform, targetId: platform, snapshotId: 'snapshot', generation: 1, capturedAt: new Date().toISOString(), nodes: [{ ref: 'e1', text: 'Ready', enabled: true, visible: true }] })),
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

  it('dispatches keyboard and app lifecycle steps through the driver', async () => {
    const android = fakeDriver('android');
    vi.mocked(android.capabilities).mockResolvedValue({
      platform: 'android', snapshots: true, accessibilityTree: true, screenshots: true, gestures: true,
      appLifecycle: true, browserNavigation: false, nativeDialogs: true,
      supportedActions: ['hideKeyboard', 'launchApp', 'terminateApp']
    });
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'lifecycle-engine', name: 'Lifecycle engine', platforms: ['android'],
      policy: { allowDestructiveActions: true },
      steps: [
        { id: 'hide', type: 'hideKeyboard' },
        { id: 'launch', type: 'launchApp', appId: 'com.example.app' },
        { id: 'stop', type: 'terminateApp' }
      ]
    });
    const result = await new AutomationEngine({ drivers: { android } }).run(definition);
    expect(result.success).toBe(true);
    expect(vi.mocked(android.perform).mock.calls.map((call) => call[0].type)).toEqual(['hideKeyboard', 'launchApp', 'terminateApp']);
  });

  it('blocks app termination unless the test explicitly allows destructive actions', async () => {
    const android = fakeDriver('android');
    vi.mocked(android.capabilities).mockResolvedValue({
      platform: 'android', snapshots: true, accessibilityTree: true, screenshots: true, gestures: true,
      appLifecycle: true, browserNavigation: false, nativeDialogs: true, supportedActions: ['terminateApp']
    });
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'termination-policy', name: 'Termination policy', platforms: ['android'],
      steps: [{ id: 'stop-app', type: 'terminateApp', appId: 'com.example.app' }]
    });
    const result = await new AutomationEngine({ drivers: { android } }).run(definition);
    expect(result.success).toBe(false);
    expect(result.platforms[0]?.steps[0]?.error).toContain('allowDestructiveActions=true');
    expect(android.perform).not.toHaveBeenCalled();
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

  it('executes snapshot assertions without dispatching a platform action', async () => {
    const android = fakeDriver('android');
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'assertion', name: 'Assert welcome',
      platforms: ['android'],
      steps: [{ id: 'welcome', type: 'assert', assertion: { kind: 'textContains', selector: { strategy: 'text', value: 'Ready' }, expected: 'Rea' } }]
    });
    const result = await new AutomationEngine({ drivers: { android } }).run(definition);
    expect(result.success).toBe(true);
    expect(android.snapshot).toHaveBeenCalledOnce();
    expect(android.perform).not.toHaveBeenCalled();
  });

  it('fails an assertion and captures evidence when the expected state is absent', async () => {
    const android = fakeDriver('android');
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'assertion-fail', name: 'Assert missing title',
      platforms: ['android'],
      steps: [{ id: 'title', type: 'assert', assertion: { kind: 'exists', selector: { strategy: 'text', value: 'Missing' } } }]
    });
    const result = await new AutomationEngine({ drivers: { android } }).run(definition);
    expect(result.success).toBe(false);
    expect(result.platforms[0]?.steps[0]?.status).toBe('failed');
    expect(result.platforms[0]?.evidence).toBeDefined();
  });
});


describe('AutomationEngine checkpoint resume', () => {
  it('restores completed platform results without rerunning them', async () => {
    const android = fakeDriver('android');
    const web = fakeDriver('web');
    const completed = {
      platform: 'android' as const, success: true, startedAt: new Date().toISOString(),
      durationMs: 12, steps: [{ id: 'done', type: 'wait', status: 'passed' as const, durationMs: 1 }]
    };
    const checkpoint = {
      version: 1 as const, runId: 'existing-run', testId: 'resume-test', definitionHash: 'PLACEHOLDER',
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status: 'running' as const, activePlatforms: [], completedPlatforms: [completed]
    };
    const store = { load: vi.fn(async () => checkpoint), save: vi.fn(async () => undefined) };
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'resume-test', name: 'Resume test',
      platforms: ['android', 'web'], steps: [{ id: 'settle', type: 'wait', timeoutMs: 1 }]
    });
    checkpoint.definitionHash = createHash('sha256').update(JSON.stringify({ definition, variables: definition.variables ?? {} })).digest('hex');
    const result = await new AutomationEngine({ drivers: { android, web } }).run(definition, {
      checkpointStore: store, resume: true
    });
    expect(result.runId).toBe('existing-run');
    expect(result.success).toBe(true);
    expect(android.connect).not.toHaveBeenCalled();
    expect(web.connect).toHaveBeenCalledOnce();
  });

  it('blocks resume when a platform was active at interruption', async () => {
    const android = fakeDriver('android');
    const store = {
      load: vi.fn(async () => ({
        version: 1 as const, runId: 'interrupted-run', testId: 'interrupted', definitionHash: 'irrelevant',
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        status: 'running' as const, activePlatforms: ['android' as const], completedPlatforms: []
      })),
      save: vi.fn(async () => undefined)
    };
    const definition = parseAutomationTest({
      schemaVersion: '1.0', id: 'interrupted', name: 'Interrupted test',
      platforms: ['android'], steps: [{ id: 'tap', type: 'tap', selector: { strategy: 'text', value: 'Pay' } }]
    });
    await expect(new AutomationEngine({ drivers: { android } }).run(definition, {
      checkpointStore: store, resume: true
    })).rejects.toThrow('blocked to avoid replaying');
    expect(android.connect).not.toHaveBeenCalled();
  });
});
