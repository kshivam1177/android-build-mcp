import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DriverConfig, PlatformKind } from './contracts.js';

const platformSchema = z.enum(['android', 'flutter', 'ios', 'web']);
const targetSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  platform: platformSchema,
  targetId: z.string().min(1).max(256).optional(),
  appId: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+$/).optional(),
  baseUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.union([z.string().max(2048), z.number(), z.boolean()])).optional(),
  labels: z.array(z.string().min(1).max(64)).max(30).default([]),
  enabled: z.boolean().default(true),
  updatedAt: z.string().datetime()
});
const registrySchema = z.object({ version: z.literal(1), targets: z.array(targetSchema) });
const leaseSchema = z.object({
  version: z.literal(1),
  leases: z.array(z.object({
    token: z.string().uuid(), targetId: z.string(), owner: z.string(),
    acquiredAt: z.string().datetime(), expiresAt: z.string().datetime()
  }))
});
export type FleetTarget = z.infer<typeof targetSchema>;
export type FleetLease = z.infer<typeof leaseSchema>['leases'][number];

const queues = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  queues.set(key, tail);
  await previous;
  try { return await work(); }
  finally { release(); if (queues.get(key) === tail) queues.delete(key); }
}

async function readJson<T>(file: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try { return schema.parse(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error('Fleet state is invalid or unreadable at ' + file + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}
async function atomicWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
}

export class FileDeviceFleet {
  readonly registryPath: string;
  readonly leasesPath: string;
  constructor(projectRoot: string) {
    const directory = path.resolve(projectRoot, '.androidmcp-framework');
    this.registryPath = path.join(directory, 'device-fleet.json');
    this.leasesPath = path.join(directory, 'device-fleet-leases.json');
  }

  async list(): Promise<FleetTarget[]> {
    return (await readJson(this.registryPath, registrySchema, { version: 1, targets: [] })).targets;
  }

  async register(input: Omit<FleetTarget, 'updatedAt'>): Promise<FleetTarget> {
    const target = targetSchema.parse({ ...input, updatedAt: new Date().toISOString() });
    return serialized(this.registryPath, async () => {
      const registry = await readJson(this.registryPath, registrySchema, { version: 1, targets: [] });
      const existing = registry.targets.findIndex((item) => item.id === target.id);
      if (existing >= 0) registry.targets[existing] = target;
      else registry.targets.push(target);
      registry.targets.sort((a, b) => a.id.localeCompare(b.id));
      await atomicWrite(this.registryPath, registry);
      return target;
    });
  }

  async remove(id: string): Promise<void> {
    await serialized(this.registryPath, async () => {
      const registry = await readJson(this.registryPath, registrySchema, { version: 1, targets: [] });
      if (!registry.targets.some((target) => target.id === id)) throw new Error('Fleet target not found: ' + id);
      const leases = await this.activeLeases();
      if (leases.some((lease) => lease.targetId === id)) throw new Error('Cannot remove a target while it has an active lease.');
      registry.targets = registry.targets.filter((target) => target.id !== id);
      await atomicWrite(this.registryPath, registry);
    });
  }

  async activeLeases(now = Date.now()): Promise<FleetLease[]> {
    return serialized(this.leasesPath, async () => {
      const state = await readJson(this.leasesPath, leaseSchema, { version: 1, leases: [] });
      const active = state.leases.filter((lease) => Date.parse(lease.expiresAt) > now);
      if (active.length !== state.leases.length) await atomicWrite(this.leasesPath, { version: 1, leases: active });
      return active;
    });
  }

  async acquire(targetId: string, owner: string, ttlSeconds = 900): Promise<FleetLease> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) throw new Error('Lease TTL must be between 30 and 3600 seconds.');
    if (!owner.trim() || owner.length > 128) throw new Error('Lease owner must contain 1–128 characters.');
    const target = (await this.list()).find((item) => item.id === targetId);
    if (!target || !target.enabled) throw new Error('Fleet target is missing or disabled: ' + targetId);
    return serialized(this.leasesPath, async () => {
      const state = await readJson(this.leasesPath, leaseSchema, { version: 1, leases: [] });
      const now = Date.now();
      state.leases = state.leases.filter((lease) => Date.parse(lease.expiresAt) > now);
      if (state.leases.some((lease) => lease.targetId === targetId)) throw new Error('Target is already leased by another run.');
      const acquiredAt = new Date(now).toISOString();
      const lease: FleetLease = { token: randomUUID(), targetId, owner, acquiredAt, expiresAt: new Date(now + ttlSeconds * 1000).toISOString() };
      state.leases.push(lease);
      await atomicWrite(this.leasesPath, state);
      return lease;
    });
  }

  async release(token: string): Promise<boolean> {
    return serialized(this.leasesPath, async () => {
      const state = await readJson(this.leasesPath, leaseSchema, { version: 1, leases: [] });
      const before = state.leases.length;
      state.leases = state.leases.filter((lease) => lease.token !== token);
      if (state.leases.length !== before) await atomicWrite(this.leasesPath, state);
      return state.leases.length !== before;
    });
  }

  driverConfig(target: FleetTarget): DriverConfig {
    return {
      platform: target.platform as PlatformKind,
      ...(target.targetId ? { targetId: target.targetId } : {}),
      ...(target.appId ? { appId: target.appId } : {}),
      ...(target.baseUrl ? { baseUrl: target.baseUrl } : {}),
      ...(target.metadata ? { metadata: target.metadata } : {})
    };
  }
}
