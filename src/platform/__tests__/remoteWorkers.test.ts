import { describe, expect, it } from 'vitest';
import { InMemoryRemoteWorkerStore, RemoteWorkerAgent, RemoteWorkerCoordinator, type RemoteJob, type RemoteJobRequest, type RemoteWorkerTransport } from '../remoteWorkers.js';
const digest = 'a'.repeat(64);
const request = (overrides: Partial<RemoteJobRequest> = {}): RemoteJobRequest => ({ runId: 'run-1', suiteId: 'smoke', platform: 'android', requiredLabels: ['pixel'], definitionDigest: digest, definition: { steps: [{ action: 'launch' }] }, timeoutMs: 60000, ...overrides });
async function setup() {
  const coordinator = new RemoteWorkerCoordinator(new InMemoryRemoteWorkerStore(), 5000);
  const credential = await coordinator.register({ protocolVersion: 1, workerId: 'android-worker-1', displayName: 'Android Worker', platforms: ['android'], labels: ['pixel', 'emulator'], capacity: 2, metadata: { region: 'local' } });
  return { coordinator, credential };
}
describe('RemoteWorkerCoordinator', () => {
  it('registers workers and never exposes credential hashes', async () => {
    const { coordinator, credential } = await setup();
    expect(credential.token).toHaveLength(64); expect(JSON.stringify(await coordinator.listWorkers())).not.toContain(credential.token);
    await expect(coordinator.register({ protocolVersion: 1, workerId: 'android-worker-1', displayName: 'Duplicate', platforms: ['android'], labels: [], capacity: 1, metadata: {} })).rejects.toThrow('already registered');
  });
  it('assigns only capability-compatible jobs and enforces worker capacity', async () => {
    const { coordinator, credential } = await setup(), job = await coordinator.enqueue(request());
    await coordinator.enqueue(request({ suiteId: 'ios-suite', platform: 'ios' }));
    expect((await coordinator.claimNext(credential.workerId, credential.token))?.id).toBe(job.id);
    await coordinator.start(credential.workerId, credential.token, job.id);
    expect(await coordinator.claimNext(credential.workerId, credential.token)).toBeNull();
  });
  it('rejects invalid credentials and unassigned transitions', async () => {
    const { coordinator, credential } = await setup();
    await expect(coordinator.claimNext(credential.workerId, '0'.repeat(64))).rejects.toThrow('authentication');
    const job = await coordinator.enqueue(request());
    await expect(coordinator.start(credential.workerId, credential.token, job.id)).rejects.toThrow('not assigned');
  });
  it('propagates cancellation to running workers and records terminal state', async () => {
    const { coordinator, credential } = await setup(), job = await coordinator.enqueue(request());
    await coordinator.claimNext(credential.workerId, credential.token); await coordinator.start(credential.workerId, credential.token, job.id);
    await coordinator.cancel(job.id);
    expect((await coordinator.heartbeat(credential.workerId, credential.token)).cancelJobIds).toContain(job.id);
    expect((await coordinator.finish(credential.workerId, credential.token, job.id, { success: true })).state).toBe('cancelled');
  });
  it('validates evidence summaries and records completion metadata', async () => {
    const { coordinator, credential } = await setup(), job = await coordinator.enqueue(request());
    await coordinator.claimNext(credential.workerId, credential.token); await coordinator.start(credential.workerId, credential.token, job.id);
    await expect(coordinator.finish(credential.workerId, credential.token, job.id, { success: true, evidence: { manifestSha256: 'bad', artifactCount: 1, totalBytes: 1 } })).rejects.toThrow('evidence summary');
    await expect(coordinator.finish(credential.workerId, credential.token, job.id, { success: true, evidence: { manifestSha256: digest, artifactCount: 4, totalBytes: 1024 } })).resolves.toMatchObject({ state: 'succeeded', evidence: { artifactCount: 4, totalBytes: 1024 } });
  });
  it('does not permit claims after a worker heartbeat expires', async () => {
    const { coordinator, credential } = await setup();
    await new Promise((resolve) => setTimeout(resolve, 5100));
    await expect(coordinator.claimNext(credential.workerId, credential.token)).rejects.toThrow('heartbeat expired');
  }, 10_000);
});

describe('RemoteWorkerAgent', () => {
  it('polls, executes and reports a claimed job', async () => {
    const job: RemoteJob = { id: 'job-1', request: request(), state: 'assigned', workerId: 'worker', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    let claims = 0, finished = 0;
    const transport: RemoteWorkerTransport = {
      heartbeat: async () => ({ accepted: true, cancelJobIds: [] }),
      claimNext: async () => claims++ === 0 ? job : null,
      start: async () => ({ ...job, state: 'running' }),
      finish: async (_worker, _token, _id, result) => { finished++; expect(result.success).toBe(true); return { ...job, state: 'succeeded' }; }
    };
    const agent = new RemoteWorkerAgent('worker', 'secret', 1, transport, async () => ({ success: true }));
    const controller = new AbortController();
    const running = agent.run(controller.signal, 100);
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await running;
    expect(claims).toBeGreaterThan(0);
    expect(finished).toBe(1);
  });
});
