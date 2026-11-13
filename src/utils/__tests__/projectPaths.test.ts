import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROJECT_CONFIG_DIR, findProjectConfigPath } from '../paths.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-paths-'));
  roots.push(root);
  return root;
}
function writeConfig(root: string, dir: string): string {
  const configPath = path.join(root, dir, 'config.yaml');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, 'schemaVersion: 1\n', 'utf8');
  return configPath;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('findProjectConfigPath', () => {
  it('prefers the canonical project configuration directory', () => {
    const root = tempRoot();
    const legacy = writeConfig(root, '.android-build-mcp');
    const canonical = writeConfig(root, PROJECT_CONFIG_DIR);
    expect(findProjectConfigPath(root)).toBe(canonical);
    expect(findProjectConfigPath(root)).not.toBe(legacy);
  });
  it('reads the first legacy directory when no canonical configuration exists', () => {
    const root = tempRoot();
    const expected = writeConfig(root, '.androidbuildmcp');
    expect(findProjectConfigPath(root)).toBe(expected);
  });
});
