import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  runId: z.string().min(1).max(128),
  source: z.object({
    gitHeadSha: z.string().regex(/^[a-f0-9]{40,64}$/i).nullable(),
    definitionManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable()
  }),
  artifacts: z.array(z.object({
    path: z.string().min(1).max(1024),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i)
  })).max(10000)
});
export type EvidenceManifest = z.infer<typeof manifestSchema>;

function safeRelativePath(value: string): boolean {
  if (path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

async function hashFile(file: string): Promise<{ sizeBytes: number; sha256: string }> {
  const data = await fs.readFile(file);
  return { sizeBytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') };
}

async function collectFiles(directory: string, relative = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (!safeRelativePath(child)) throw new Error('Unsafe evidence artifact path: ' + child);
    const absolute = path.join(directory, child);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in evidence bundles: ' + child);
    if (stat.isDirectory()) files.push(...await collectFiles(directory, child));
    else if (stat.isFile() && child !== 'evidence-manifest.json') files.push(child);
    else throw new Error('Unsupported evidence artifact entry: ' + child);
    if (files.length > 10000) throw new Error('Evidence bundle exceeds the 10000-file limit.');
  }
  return files;
}

export async function createEvidenceManifest(input: {
  reportDirectory: string;
  runId: string;
  gitHeadSha: string | null;
  definitionManifestSha256: string | null;
}): Promise<EvidenceManifest> {
  const files = await collectFiles(input.reportDirectory);
  const artifacts = [];
  for (const relative of files) {
    const absolute = path.join(input.reportDirectory, ...relative.split('/'));
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Evidence artifact changed during manifest creation: ' + relative);
    const digest = await hashFile(absolute);
    artifacts.push({ path: relative, ...digest });
  }
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: input.runId,
    source: { gitHeadSha: input.gitHeadSha, definitionManifestSha256: input.definitionManifestSha256 },
    artifacts
  });
  await fs.writeFile(path.join(input.reportDirectory, 'evidence-manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
  return manifest;
}

export async function validateEvidenceManifest(reportDirectory: string): Promise<{
  valid: boolean;
  runId: string;
  checked: number;
  missing: string[];
  modified: string[];
  unsafe: string[];
}> {
  const manifestPath = path.join(reportDirectory, 'evidence-manifest.json');
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const manifest = manifestSchema.parse(raw);
  const missing: string[] = [];
  const modified: string[] = [];
  const unsafe: string[] = [];
  const listed = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!safeRelativePath(artifact.path) || artifact.path === 'evidence-manifest.json' || listed.has(artifact.path)) {
      unsafe.push(artifact.path);
      continue;
    }
    listed.add(artifact.path);
    const absolute = path.resolve(reportDirectory, ...artifact.path.split('/'));
    const relative = path.relative(path.resolve(reportDirectory), absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      unsafe.push(artifact.path);
      continue;
    }
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        unsafe.push(artifact.path);
        continue;
      }
      const digest = await hashFile(absolute);
      if (digest.sizeBytes !== artifact.sizeBytes || digest.sha256 !== artifact.sha256) modified.push(artifact.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(artifact.path);
      else throw error;
    }
  }
  const actual = await collectFiles(reportDirectory);
  for (const file of actual) if (!listed.has(file)) modified.push(file);
  return { valid: missing.length === 0 && modified.length === 0 && unsafe.length === 0, runId: manifest.runId, checked: manifest.artifacts.length, missing, modified: [...new Set(modified)], unsafe };
}
