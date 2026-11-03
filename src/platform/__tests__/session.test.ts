import { describe, expect, it, vi } from 'vitest';
import { DriverSessionManager } from '../session.js';
import { AutomationError, type DriverConfig, type PlatformDriver } from '../contracts.js';

function driver() {
  return {
    platform: 'web' as const,
    connect: vi.fn(async (config: DriverConfig) => ({ id: 'session-' + (config.targetId ?? 'default'), platform: 'web' as const, targetId: config.targetId ?? 'default', connectedAt: new Date().toISOString() })),
    disconnect: vi.fn(async () => undefined)
  } as unknown as PlatformDriver;
}

describe('DriverSessionManager isolation', () => {
  it('rejects reuse of one mutable driver instance across concurrent sessions', async () => {
    const manager = new DriverSessionManager();
    const browser = driver();
    await manager.open(browser, { platform: 'web', targetId: 'browser-1' });
    await expect(manager.open(browser, { platform: 'web', targetId: 'browser-2' }))
      .rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    await manager.close('session-browser-1');
    await expect(manager.open(browser, { platform: 'web', targetId: 'browser-2' })).resolves.toBeDefined();
  });

  it('rejects concurrent reservations for the same target', async () => {
    const manager = new DriverSessionManager();
    const first = driver();
    const second = driver();
    let release!: () => void;
    vi.mocked(first.connect).mockImplementationOnce(async (config) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { id: 'first', platform: 'web', targetId: config.targetId ?? 'default', connectedAt: new Date().toISOString() };
    });
    const opening = manager.open(first, { platform: 'web', targetId: 'same-target' });
    await Promise.resolve();
    await expect(manager.open(second, { platform: 'web', targetId: 'same-target' }))
      .rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    release();
    await opening;
    await manager.close('first');
  });

  it('reserves a physical target across separate engine session managers', async () => {
    const firstManager = new DriverSessionManager();
    const secondManager = new DriverSessionManager();
    const firstDriver = driver();
    const secondDriver = driver();
    await firstManager.open(firstDriver, { platform: 'web', targetId: 'shared-target' });
    await expect(secondManager.open(secondDriver, { platform: 'web', targetId: 'shared-target' }))
      .rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    await firstManager.close('session-shared-target');
    await expect(secondManager.open(secondDriver, { platform: 'web', targetId: 'shared-target' })).resolves.toBeDefined();
    await secondManager.close('session-shared-target');
  });

  it('disconnects after a driver connection fails partway through', async () => {
    const manager = new DriverSessionManager();
    const broken = driver();
    vi.mocked(broken.connect).mockRejectedValueOnce(new AutomationError('CONNECTION_FAILED', 'partial connect'));
    await expect(manager.open(broken, { platform: 'web', targetId: 'broken' })).rejects.toThrow('partial connect');
    expect(broken.disconnect).toHaveBeenCalledOnce();
  });
});
