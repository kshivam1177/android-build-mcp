import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileRunCheckpointStore, type RunCheckpoint } from '../checkpoint.js';

describe('FileRunCheckpointStore', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it('writes atomically and reloads a checkpoint', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'androidmcp-checkpoint-'));
    const file = path.join(directory, 'run.json');
    const store = new FileRunCheckpointStore(file);
    const checkpoint: RunCheckpoint = {
      version: 1, runId: 'run-1', testId: 'smoke', definitionHash: 'sha256-test', startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), status: 'running', activePlatforms: ['android'], completedPlatforms: []
    };
    await store.save(checkpoint);
    await expect(store.load()).resolves.toEqual(checkpoint);
  });

  it('returns undefined when no checkpoint exists', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'androidmcp-checkpoint-'));
    await expect(new FileRunCheckpointStore(path.join(directory, 'missing.json')).load()).resolves.toBeUndefined();
  });
});
