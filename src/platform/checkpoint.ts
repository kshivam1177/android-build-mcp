import fs from 'node:fs/promises';
import path from 'node:path';
import type { PlatformKind } from './contracts.js';
import type { PlatformRunResult } from './engine.js';

export interface RunCheckpoint {
  version: 1;
  runId: string;
  testId: string;
  definitionHash: string;
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'completed' | 'cancelled';
  activePlatforms: PlatformKind[];
  completedPlatforms: PlatformRunResult[];
}

export interface RunCheckpointStore {
  load(): Promise<RunCheckpoint | undefined>;
  save(checkpoint: RunCheckpoint): Promise<void>;
}

/** Local atomic JSON checkpoint storage. The caller chooses the project-local path. */
export class FileRunCheckpointStore implements RunCheckpointStore {
  constructor(readonly filePath: string) {
    if (!filePath.trim()) throw new Error('Checkpoint file path must not be empty.');
  }

  async load(): Promise<RunCheckpoint | undefined> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as RunCheckpoint;
      if (raw.version !== 1 || typeof raw.runId !== 'string' || typeof raw.testId !== 'string' ||
          !Array.isArray(raw.activePlatforms) || !Array.isArray(raw.completedPlatforms)) {
        throw new Error('Checkpoint file has an unsupported or invalid format.');
      }
      return raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(checkpoint: RunCheckpoint): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true });
    const temporaryPath = this.filePath + '.' + checkpoint.runId + '.tmp';
    await fs.writeFile(temporaryPath, JSON.stringify(checkpoint, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }
}
