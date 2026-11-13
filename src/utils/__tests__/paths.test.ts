import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findProjectConfigPath, resolveProjectRoot } from '../paths.js';

describe('project root discovery', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('discovers the nearest framework config from a nested directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-root-'));
    roots.push(root);
    const nested = path.join(root, 'packages', 'mobile', 'lib');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(root, '.testorbit'), { recursive: true });
    fs.writeFileSync(path.join(root, '.testorbit', 'config.yaml'), 'schemaVersion: 1\n');

    expect(resolveProjectRoot(nested)).toBe(root);
    expect(findProjectConfigPath(nested)).toBe(path.join(root, '.testorbit', 'config.yaml'));
  });

  it('discovers the nearest Git root and does not cross a nested repository boundary', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-git-parent-'));
    roots.push(parent);
    const outer = path.join(parent, 'outer');
    const inner = path.join(outer, 'packages', 'mobile');
    fs.mkdirSync(path.join(outer, '.git'), { recursive: true });
    fs.mkdirSync(path.join(inner, '.git'), { recursive: true });
    fs.mkdirSync(path.join(outer, '.testorbit'), { recursive: true });
    fs.writeFileSync(path.join(outer, '.testorbit', 'config.yaml'), 'schemaVersion: 1\n');

    expect(resolveProjectRoot(path.join(inner, 'lib'))).toBe(inner);
    expect(findProjectConfigPath(path.join(inner, 'lib'))).toBeNull();
  });

  it('falls back to the supplied directory when no marker exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-fallback-'));
    roots.push(root);
    const nested = path.join(root, 'nested');
    fs.mkdirSync(nested);
    expect(resolveProjectRoot(nested)).toBe(nested);
  });
});
