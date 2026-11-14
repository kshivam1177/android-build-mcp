import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareKnowledgeAssets, scanKnowledgeAssets, writeKnowledgeManifest, readKnowledgeManifest } from '../knowledge.js';

describe('persistent test knowledge', () => {
  it('indexes only JSON and Markdown knowledge files and hashes content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'amf-knowledge-'));
    try {
      await mkdir(path.join(root, 'testcases'), { recursive: true });
      await writeFile(path.join(root, 'testcases', 'login.json'), '{"id":"login"}');
      await writeFile(path.join(root, 'testcases', 'screenshot.png'), Buffer.from([1, 2, 3]));
      const assets = await scanKnowledgeAssets(root);
      expect(assets).toHaveLength(1);
      expect(assets[0]?.path).toBe('testcases/login.json');
      expect(assets[0]?.kind).toBe('test-case');
      expect(assets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('detects added, changed, and removed assets by content hash', () => {
    const diff = compareKnowledgeAssets(
      [{ path: 'a.json', kind: 'other', sha256: 'old', bytes: 1, updatedAt: '' }, { path: 'removed.md', kind: 'instruction', sha256: 'x', bytes: 1, updatedAt: '' }],
      [{ path: 'a.json', kind: 'other', sha256: 'new', bytes: 1, updatedAt: '' }, { path: 'new.json', kind: 'other', sha256: 'y', bytes: 1, updatedAt: '' }],
    );
    expect(diff).toEqual({ added: ['new.json'], changed: ['a.json'], removed: ['removed.md'] });
  });

  it('writes manifests atomically and reads them back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'amf-knowledge-'));
    try {
      const file = path.join(root, '.testorbit', 'test-knowledge.json');
      const manifest = {
        schemaVersion: 1 as const, generatedAt: new Date(0).toISOString(), projectRoot: root,
        assets: [], changesSinceLastRefresh: { added: [], changed: [], removed: [] },
        staleTestCases: [], latestKnownFailures: [], warnings: [],
      };
      await writeKnowledgeManifest(file, manifest);
      expect(await readKnowledgeManifest(file)).toEqual(manifest);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
