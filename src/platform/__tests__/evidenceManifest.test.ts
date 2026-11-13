import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvidenceManifest, validateEvidenceManifest } from '../reporting/evidenceManifest.js';

const roots: string[] = [];
async function createReportDirectory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amf-evidence-'));
  roots.push(root);
  const directory = path.join(root, '.testorbit', 'test-reports', '2026-11-03', 'run-1');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'report.json'), '{"passed":true}', 'utf8');
  await fs.mkdir(path.join(directory, 'screenshots'));
  await fs.writeFile(path.join(directory, 'screenshots', 'screen.png'), Buffer.from([1, 2, 3, 4]));
  return directory;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('cross-platform evidence manifest', () => {
  it('creates a deterministic inventory and validates unchanged artifacts', async () => {
    const directory = await createReportDirectory();
    const manifest = await createEvidenceManifest({
      reportDirectory: directory, runId: 'run-1',
      gitHeadSha: 'a'.repeat(40), definitionManifestSha256: 'b'.repeat(64)
    });
    expect(manifest.artifacts.map((item) => item.path)).toEqual(['report.json', 'screenshots/screen.png']);
    await expect(validateEvidenceManifest(directory)).resolves.toMatchObject({ valid: true, checked: 2, runId: 'run-1' });
  });

  it('detects modified, missing and unlisted artifacts', async () => {
    const directory = await createReportDirectory();
    await createEvidenceManifest({ reportDirectory: directory, runId: 'run-1', gitHeadSha: null, definitionManifestSha256: null });
    await fs.writeFile(path.join(directory, 'report.json'), 'tampered', 'utf8');
    await fs.rm(path.join(directory, 'screenshots', 'screen.png'));
    await fs.writeFile(path.join(directory, 'unexpected.txt'), 'extra', 'utf8');
    const result = await validateEvidenceManifest(directory);
    expect(result.valid).toBe(false);
    expect(result.modified).toContain('report.json');
    expect(result.modified).toContain('unexpected.txt');
    expect(result.missing).toContain('screenshots/screen.png');
  });

  it('rejects path traversal and duplicate artifact entries in a manifest', async () => {
    const directory = await createReportDirectory();
    await fs.writeFile(path.join(directory, 'evidence-manifest.json'), JSON.stringify({
      schemaVersion: 1, generatedAt: new Date().toISOString(), runId: 'run-1',
      source: { gitHeadSha: null, definitionManifestSha256: null },
      artifacts: [{ path: '../outside.txt', sizeBytes: 0, sha256: 'a'.repeat(64) }]
    }));
    const result = await validateEvidenceManifest(directory);
    expect(result.valid).toBe(false);
    expect(result.unsafe).toContain('../outside.txt');
  });

  it('marks symlink additions as unsafe during validation', async () => {
    const directory = await createReportDirectory();
    await createEvidenceManifest({ reportDirectory: directory, runId: 'run-1', gitHeadSha: null, definitionManifestSha256: null });
    await fs.symlink(path.join(directory, 'report.json'), path.join(directory, 'unexpected-link.json'));
    const result = await validateEvidenceManifest(directory);
    expect(result.valid).toBe(false);
    expect(result.unsafe.length).toBeGreaterThan(0);
  });

  it('rejects symlinks inside evidence bundles', async () => {
    const directory = await createReportDirectory();
    await fs.symlink(path.join(directory, 'report.json'), path.join(directory, 'linked-report.json'));
    await expect(createEvidenceManifest({
      reportDirectory: directory, runId: 'run-1',
      gitHeadSha: null, definitionManifestSha256: null
    })).rejects.toThrow('Symbolic links are not allowed');
  });
});
