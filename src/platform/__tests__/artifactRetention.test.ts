import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findExpiredReports } from '../../tools/cross-platform-automation/manage_cross_platform_artifacts.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('cross-platform artifact retention', () => {
  it('selects only old generated suite runs with a regular evidence manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amf-retention-'));
    roots.push(root);
    const reports = path.join(root, '.androidmcp-framework', 'test-reports');
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const generated = path.join(reports, oldDate, '10-20-30-cross-platform-suite-1234abcd');
    const noManifest = path.join(reports, oldDate, '10-20-30-cross-platform-suite-deadbeef');
    const internal = path.join(reports, '.runs', 'cross-platform');
    await fs.mkdir(generated, { recursive: true });
    await fs.mkdir(noManifest, { recursive: true });
    await fs.mkdir(internal, { recursive: true });
    await fs.writeFile(path.join(generated, 'evidence-manifest.json'), '{}');
    await fs.writeFile(path.join(internal, 'checkpoint.json'), '{}');
    await fs.writeFile(path.join(reports, oldDate, 'user-notes.txt'), 'keep');
    const result = await findExpiredReports(reports, 30);
    expect(result).toEqual([generated]);
  });

  it('ignores symlinked date folders and non-generated run names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amf-retention-'));
    roots.push(root);
    const reports = path.join(root, 'reports');
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.mkdir(reports);
    await fs.symlink(outside, path.join(reports, oldDate));
    expect(await findExpiredReports(reports, 30)).toEqual([]);
  });
});
