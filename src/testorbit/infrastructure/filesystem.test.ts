import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPlatformDir, listFiles, listSubdirectories, readFileText, writeFileAtomic, writeFileWithBackup } from './filesystem.js';
import { TestOrbitError } from '../domain/errors.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-fs-'));
}

describe('getPlatformDir', () => {
  it('returns the platform folder under .testorbit', () => {
    expect(getPlatformDir('/proj', 'android')).toBe(path.join('/proj', '.testorbit', 'android'));
    expect(getPlatformDir('/proj', 'ios')).toBe(path.join('/proj', '.testorbit', 'ios'));
    expect(getPlatformDir('/proj', 'flutter')).toBe(path.join('/proj', '.testorbit', 'flutter'));
    expect(getPlatformDir('/proj', 'web')).toBe(path.join('/proj', '.testorbit', 'web'));
  });

  it('rejects an unsupported platform', () => {
    expect(() => getPlatformDir('/proj', 'windows' as never)).toThrow(TestOrbitError);
  });
});

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temp file behind', () => {
    const dir = tempDir();
    const file = path.join(dir, 'screen.json');
    writeFileAtomic(file, '{"a":1}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(fs.readdirSync(dir)).toEqual(['screen.json']);
  });

  it('creates missing parent directories', () => {
    const dir = tempDir();
    const file = path.join(dir, 'a', 'b', 'screen.json');
    writeFileAtomic(file, 'x');
    expect(fs.readFileSync(file, 'utf8')).toBe('x');
  });
});

describe('writeFileWithBackup', () => {
  it('returns null and writes when no previous file exists', () => {
    const dir = tempDir();
    const file = path.join(dir, 'screen.json');
    expect(writeFileWithBackup(file, 'v1')).toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe('v1');
  });

  it('keeps a .bak of the previous contents on overwrite', () => {
    const dir = tempDir();
    const file = path.join(dir, 'screen.json');
    writeFileAtomic(file, 'v1');
    const backup = writeFileWithBackup(file, 'v2');
    expect(backup).toBe(`${file}.bak`);
    expect(fs.readFileSync(file, 'utf8')).toBe('v2');
    expect(fs.readFileSync(backup as string, 'utf8')).toBe('v1');
  });
});

describe('readFileText / listSubdirectories / listFiles', () => {
  it('reads a file and lists a directory sorted', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'b'));
    fs.mkdirSync(path.join(dir, 'a'));
    writeFileAtomic(path.join(dir, 'z.json'), '{"x":1}');
    writeFileAtomic(path.join(dir, 'a.json'), '{}');
    expect(readFileText(path.join(dir, 'z.json'))).toBe('{"x":1}');
    expect(listSubdirectories(dir)).toEqual(['a', 'b']);
    expect(listFiles(dir)).toEqual(['a.json', 'z.json']);
  });

  it('returns [] for a missing directory and throws a typed error for a missing file', () => {
    const dir = tempDir();
    expect(listSubdirectories(path.join(dir, 'nope'))).toEqual([]);
    expect(listFiles(path.join(dir, 'nope'))).toEqual([]);
    expect(() => readFileText(path.join(dir, 'nope.json'))).toThrow(TestOrbitError);
  });
});
