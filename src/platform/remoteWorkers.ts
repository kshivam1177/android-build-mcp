import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const REMOTE_WORKER_PROTOCOL_VERSION = 1 as const;
const platformSchema = z.enum(['android', 'flutter', 'ios', 'web']);
export const workerRegistrationSchema = z.object({
  protocolVersion: z.literal(REMOTE_WORKER_PROTOCOL_VERSION),
  workerId: z.string().min(3).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  displayName: z.string().min(1).max(120),
  platforms: z.array(platformSchema).min(1).max(4),
  labels: z.array(z.string().min(1).max(64)).max(50).default([]),
  capacity: z.number().int().min(1).max(32).default(1),
  metadata: z.record(z.string(), z.union([z.string().max(512), z.number(), z.boolean()])).default({})
});
export const remoteJobRequestSchema = z.object({
  runId: z.string().min(1).max(128), suiteId: z.string().min(1).max(128),
  platform: platformSchema, requiredLabels: z.array(z.string().min(1).max(64)).max(50).default([]),
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/), definition: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000)
});
export type WorkerRegistration = z.infer<typeof workerRegistrationSchema>;
export type RemoteJobRequest = z.infer<typeof remoteJobRequestSchema>;
export type RemoteJobState = 'queued' | 'assigned' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface RemoteJob {
  id: string; request: RemoteJobRequest; state: RemoteJobState; workerId?: string;
  createdAt: string; updatedAt: string; cancelRequestedAt?: string; error?: string;
  evidence?: { manifestSha256: string; artifactCount: number; totalBytes: number };
}
export interface RegisteredWorker extends WorkerRegistration {
  tokenHash: string; registeredAt: string; lastHeartbeatAt: string;
  status: 'online' | 'offline'; activeJobs: string[];
}
export interface RemoteWorkerStore {
  getWorkers(): Promise<RegisteredWorker[]>; putWorker(worker: RegisteredWorker): Promise<void>;
  getJobs(): Promise<RemoteJob[]>; putJob(job: RemoteJob): Promise<void>;
}
/** Reference adapter for a single coordinator process; not a distributed queue. */
export class InMemoryRemoteWorkerStore implements RemoteWorkerStore {
  private readonly workers = new Map<string, RegisteredWorker>();
  private readonly jobs = new Map<string, RemoteJob>();
  async getWorkers(): Promise<RegisteredWorker[]> { return [...this.workers.values()].map((w) => structuredClone(w)); }
  async putWorker(worker: RegisteredWorker): Promise<void> { this.workers.set(worker.workerId, structuredClone(worker)); }
  async getJobs(): Promise<RemoteJob[]> { return [...this.jobs.values()].map((j) => structuredClone(j)); }
  async putJob(job: RemoteJob): Promise<void> { this.jobs.set(job.id, structuredClone(job)); }
}
const nowIso = () => new Date().toISOString();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
/** Typed coordinator state machine. Multi-replica stores must make claims/updates transactional. */
export class RemoteWorkerCoordinator {
  private mutationQueue: Promise<void> = Promise.resolve();
  constructor(private readonly store: RemoteWorkerStore = new InMemoryRemoteWorkerStore(), private readonly heartbeatTtlMs = 45_000) {
    if (!Number.isInteger(heartbeatTtlMs) || heartbeatTtlMs < 5_000 || heartbeatTtlMs > 300_000) throw new Error('Heartbeat TTL must be between 5000 and 300000 ms.');
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue; let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous; try { return await work(); } finally { release(); }
  }
  async register(input: WorkerRegistration): Promise<{ workerId: string; token: string }> {
    return this.exclusive(async () => {
      const worker = workerRegistrationSchema.parse(input);
      if ((await this.store.getWorkers()).some((item) => item.workerId === worker.workerId)) throw new Error('Worker ID is already registered.');
      const token = randomBytes(32).toString('hex'), at = nowIso();
      await this.store.putWorker({ ...worker, tokenHash: sha256(token), registeredAt: at, lastHeartbeatAt: at, status: 'online', activeJobs: [] });
      return { workerId: worker.workerId, token };
    });
  }
  private async authenticated(workerId: string, token: string): Promise<RegisteredWorker> {
    const worker = (await this.store.getWorkers()).find((item) => item.workerId === workerId);
    if (!worker || !safeEqualHex(worker.tokenHash, sha256(token))) throw new Error('Remote worker authentication failed.');
    if (Date.now() - Date.parse(worker.lastHeartbeatAt) > this.heartbeatTtlMs) throw new Error('Remote worker heartbeat expired.');
    return worker;
  }
  async heartbeat(workerId: string, token: string): Promise<{ accepted: true; cancelJobIds: string[] }> {
    return this.exclusive(async () => {
      const worker = await this.authenticated(workerId, token); worker.lastHeartbeatAt = nowIso(); worker.status = 'online';
      const jobs = await this.store.getJobs();
      const cancelJobIds = jobs.filter((job) => job.workerId === workerId && job.state === 'running' && job.cancelRequestedAt).map((job) => job.id);
      await this.store.putWorker(worker); return { accepted: true, cancelJobIds };
    });
  }
  async enqueue(input: RemoteJobRequest): Promise<RemoteJob> {
    return this.exclusive(async () => {
      const request = remoteJobRequestSchema.parse(input), jobs = await this.store.getJobs();
      if (jobs.some((job) => job.request.runId === request.runId && job.request.suiteId === request.suiteId && job.request.platform === request.platform && !['failed', 'cancelled'].includes(job.state))) throw new Error('An active or successful job already exists for this run, suite and platform.');
      const at = nowIso(), job: RemoteJob = { id: randomBytes(16).toString('hex'), request, state: 'queued', createdAt: at, updatedAt: at };
      await this.store.putJob(job); return job;
    });
  }
  async claimNext(workerId: string, token: string): Promise<RemoteJob | null> {
    return this.exclusive(async () => {
      const worker = await this.authenticated(workerId, token), jobs = await this.store.getJobs();
      const active = jobs.filter((job) => job.workerId === workerId && ['assigned', 'running'].includes(job.state));
      if (active.length >= worker.capacity) return null;
      const next = jobs.filter((job) => job.state === 'queued' && worker.platforms.includes(job.request.platform) && job.request.requiredLabels.every((label) => worker.labels.includes(label))).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next) return null;
      next.workerId = workerId; next.state = 'assigned'; next.updatedAt = nowIso();
      worker.activeJobs = [...new Set([...worker.activeJobs, next.id])];
      await this.store.putJob(next); await this.store.putWorker(worker); return next;
    });
  }
  async start(workerId: string, token: string, jobId: string): Promise<RemoteJob> {
    return this.exclusive(async () => {
      await this.authenticated(workerId, token);
      const job = (await this.store.getJobs()).find((item) => item.id === jobId);
      if (!job || job.workerId !== workerId || job.state !== 'assigned') throw new Error('Job is not assigned to this worker.');
      job.state = 'running'; job.updatedAt = nowIso(); await this.store.putJob(job); return job;
    });
  }
  async cancel(jobId: string): Promise<RemoteJob> {
    return this.exclusive(async () => {
      const job = (await this.store.getJobs()).find((item) => item.id === jobId);
      if (!job) throw new Error('Remote job not found.');
      if (['succeeded', 'failed', 'cancelled'].includes(job.state)) return job;
      job.cancelRequestedAt = nowIso(); if (job.state !== 'running') job.state = 'cancelled';
      job.updatedAt = nowIso(); await this.store.putJob(job); return job;
    });
  }
  async finish(workerId: string, token: string, jobId: string, result: { success: boolean; error?: string; evidence?: { manifestSha256: string; artifactCount: number; totalBytes: number } }): Promise<RemoteJob> {
    return this.exclusive(async () => {
      await this.authenticated(workerId, token);
      const job = (await this.store.getJobs()).find((item) => item.id === jobId);
      if (!job || job.workerId !== workerId || job.state !== 'running') throw new Error('Job is not running on this worker.');
      if (result.evidence) {
        const e = result.evidence;
        if (!/^[a-f0-9]{64}$/.test(e.manifestSha256) || !Number.isInteger(e.artifactCount) || e.artifactCount < 0 || !Number.isSafeInteger(e.totalBytes) || e.totalBytes < 0) throw new Error('Remote evidence summary is invalid.');
        job.evidence = e;
      }
      job.state = job.cancelRequestedAt ? 'cancelled' : result.success ? 'succeeded' : 'failed';
      if (result.error) job.error = result.error.slice(0, 4000);
      job.updatedAt = nowIso(); await this.store.putJob(job);
      const worker = (await this.store.getWorkers()).find((item) => item.workerId === workerId);
      if (worker) { worker.activeJobs = worker.activeJobs.filter((id) => id !== jobId); await this.store.putWorker(worker); }
      return job;
    });
  }
  async listWorkers(): Promise<Array<Omit<RegisteredWorker, 'tokenHash'>>> {
    const cutoff = Date.now() - this.heartbeatTtlMs;
    return (await this.store.getWorkers()).map(({ tokenHash: _secret, ...worker }) => ({ ...worker, status: Date.parse(worker.lastHeartbeatAt) >= cutoff ? 'online' : 'offline' }));
  }
  async listJobs(): Promise<RemoteJob[]> { return this.store.getJobs(); }
}

export interface RemoteWorkerTransport {
  heartbeat(workerId: string, token: string): Promise<{ accepted: true; cancelJobIds: string[] }>;
  claimNext(workerId: string, token: string): Promise<RemoteJob | null>;
  start(workerId: string, token: string, jobId: string): Promise<RemoteJob>;
  finish(workerId: string, token: string, jobId: string, result: { success: boolean; error?: string; evidence?: { manifestSha256: string; artifactCount: number; totalBytes: number } }): Promise<RemoteJob>;
}
export type RemoteJobExecutor = (job: RemoteJob, signal: AbortSignal) => Promise<{ success: boolean; error?: string; evidence?: { manifestSha256: string; artifactCount: number; totalBytes: number } }>;
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Pull-based worker loop. The transport is expected to use authenticated TLS. */
export class RemoteWorkerAgent {
  private readonly controllers = new Map<string, AbortController>();
  private readonly executions = new Map<string, Promise<void>>();
  constructor(
    private readonly workerId: string,
    private readonly token: string,
    private readonly capacity: number,
    private readonly transport: RemoteWorkerTransport,
    private readonly execute: RemoteJobExecutor
  ) {
    if (!workerId || !token || !Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error('Remote worker agent configuration is invalid.');
  }

  async run(signal: AbortSignal, pollIntervalMs = 1000): Promise<void> {
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) throw new Error('Worker poll interval must be between 100 and 60000 ms.');
    while (!signal.aborted) {
      const heartbeat = await this.transport.heartbeat(this.workerId, this.token);
      for (const jobId of heartbeat.cancelJobIds) this.controllers.get(jobId)?.abort(new Error('Remote job cancellation requested.'));
      while (!signal.aborted && this.executions.size < this.capacity) {
        const job = await this.transport.claimNext(this.workerId, this.token);
        if (!job) break;
        await this.transport.start(this.workerId, this.token, job.id);
        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        const execution = this.execute(job, controller.signal)
          .then((result) => this.transport.finish(this.workerId, this.token, job.id, result))
          .catch((error: unknown) => this.transport.finish(this.workerId, this.token, job.id, { success: false, error: error instanceof Error ? error.message : String(error) }))
          .then(() => undefined)
          .finally(() => { this.controllers.delete(job.id); this.executions.delete(job.id); });
        this.executions.set(job.id, execution);
      }
      if (!signal.aborted) await delay(pollIntervalMs, signal);
    }
    for (const controller of this.controllers.values()) controller.abort(new Error('Remote worker is shutting down.'));
    await Promise.allSettled(this.executions.values());
  }
}
