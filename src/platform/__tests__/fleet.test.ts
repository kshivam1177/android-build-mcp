import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileDeviceFleet } from '../fleet.js';

const roots: string[] = [];
async function createFleet() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amf-fleet-'));
  roots.push(root);
  const fleet = new FileDeviceFleet(root);
  await fleet.register({ id: 'pixel-8', platform: 'android', targetId: 'emulator-5554', labels: ['smoke'], enabled: true });
  return fleet;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('FileDeviceFleet', () => {
  it('registers, updates and removes targets deterministically', async () => {
    const fleet = await createFleet();
    await fleet.register({ id: 'pixel-8', platform: 'android', targetId: 'emulator-5556', labels: [], enabled: true });
    expect((await fleet.list())[0].targetId).toBe('emulator-5556');
    await fleet.remove('pixel-8');
    expect(await fleet.list()).toEqual([]);
  });

  it('grants one exclusive lease and blocks a second owner', async () => {
    const fleet = await createFleet();
    const lease = await fleet.acquire('pixel-8', 'run-1', 60);
    await expect(fleet.acquire('pixel-8', 'run-2', 60)).rejects.toThrow('already leased');
    await expect(fleet.remove('pixel-8')).rejects.toThrow('active lease');
    expect(await fleet.release(lease.token)).toBe(true);
    expect(await fleet.release(lease.token)).toBe(false);
  });

  it('serializes concurrent acquisition attempts for the same target', async () => {
    const fleet = await createFleet();
    const results = await Promise.allSettled([
      fleet.acquire('pixel-8', 'agent-a', 60),
      fleet.acquire('pixel-8', 'agent-b', 60)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('expires stale leases and permits a new owner', async () => {
    const fleet = await createFleet();
    const lease = await fleet.acquire('pixel-8', 'run-1', 30);
    expect(await fleet.activeLeases(Date.parse(lease.expiresAt) + 1)).toEqual([]);
    await expect(fleet.acquire('pixel-8', 'run-2', 30)).resolves.toMatchObject({ owner: 'run-2' });
  });

  it('rejects invalid lease bounds and disabled or unknown targets', async () => {
    const fleet = await createFleet();
    await expect(fleet.acquire('pixel-8', 'run', 10)).rejects.toThrow('between 30 and 3600');
    await expect(fleet.acquire('missing', 'run')).rejects.toThrow('missing or disabled');
    await fleet.register({ id: 'disabled', platform: 'web', baseUrl: 'https://example.test', labels: [], enabled: false });
    await expect(fleet.acquire('disabled', 'run')).rejects.toThrow('missing or disabled');
  });

  it('refuses malformed persisted state instead of silently resetting it', async () => {
    const fleet = await createFleet();
    await fs.writeFile(fleet.registryPath, '{"version":99,"targets":[]}', 'utf8');
    await expect(fleet.list()).rejects.toThrow('invalid or unreadable');
  });
});
