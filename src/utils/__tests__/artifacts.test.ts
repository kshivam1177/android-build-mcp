import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifactPath, timestampedArtifactName } from '../artifacts.js';

describe('project artifact paths', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates generated artifacts under the project config directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-artifacts-'));
    roots.push(root);

    const output = createArtifactPath(root, 'screenshots', 'home-screen.png');

    expect(output).toBe(path.join(root, '.testorbit', 'artifacts', 'screenshots', 'home-screen.png'));
    expect(fs.existsSync(path.dirname(output))).toBe(true);
  });

  it('discovers the project root when called from a nested package directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-discovered-root-'));
    roots.push(root);
    const nested = path.join(root, 'packages', 'mobile');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });

    const output = createArtifactPath(nested, 'screenshots', 'screen.png');

    expect(output).toBe(path.join(root, '.testorbit', 'artifacts', 'screenshots', 'screen.png'));
  });

  it('honors a custom project root when no discovery marker exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-custom-root-'));
    roots.push(root);

    const output = createArtifactPath(root, 'snapshots', 'tree.json');

    expect(output).toBe(path.join(root, '.testorbit', 'artifacts', 'snapshots', 'tree.json'));
  });

  it('rejects categories that could escape the artifacts directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-artifacts-'));
    roots.push(root);

    expect(() => createArtifactPath(root, '../outside', 'file.json')).toThrow('Invalid artifact category');
  });

  it('does not overwrite an artifact when a filename already exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-artifacts-'));
    roots.push(root);

    const first = createArtifactPath(root, 'screenshots', 'home-screen.png');
    fs.writeFileSync(first, 'first');
    const second = createArtifactPath(root, 'screenshots', 'home-screen.png');

    expect(second).toBe(path.join(root, '.testorbit', 'artifacts', 'screenshots', 'home-screen-1.png'));
    expect(fs.readFileSync(first, 'utf8')).toBe('first');
  });

  it('creates filesystem-safe timestamped names', () => {
    const name = timestampedArtifactName('device/id', '.png', new Date('2026-10-26T10:11:12.123Z'));
    expect(name).toBe('device_id-2026-10-26T10-11-12-123Z.png');
  });
});
