import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, isPathInsideDirectory, readPackageVersion, runSelfUpdate } from '../update.js';

describe('amf update helpers', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('detects whether the CLI belongs to the global npm installation', () => {
    const root = path.join(os.tmpdir(), 'npm-global');
    expect(isPathInsideDirectory(path.join(root, 'node_modules', 'testorbit'), root)).toBe(true);
    expect(isPathInsideDirectory(path.join(os.tmpdir(), 'project', 'node_modules', 'testorbit'), root)).toBe(false);
    expect(isPathInsideDirectory(root, root)).toBe(true);
  });

  it('reads package versions safely and compares semantic versions', () => {
    expect(readPackageVersion('{"version":"1.2.3"}')).toBe('1.2.3');
    expect(readPackageVersion('{"version":3}')).toBeUndefined();
    expect(readPackageVersion('not json')).toBeUndefined();
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(-1);
    expect(compareVersions('invalid', '1.2.3')).toBeUndefined();
  });

  it('installs only a newer version and removes only the configured npx cache', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-update-'));
    roots.push(root);
    const globalRoot = path.join(root, 'node_modules');
    const packageRoot = path.join(globalRoot, 'testorbit');
    const cacheRoot = path.join(root, 'npm-cache');
    const npxCache = path.join(cacheRoot, '_npx');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(npxCache, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"testorbit","version":"1.0.0"}');
    fs.writeFileSync(path.join(npxCache, 'cache-entry'), 'remove me');
    fs.writeFileSync(path.join(cacheRoot, 'other-cache-entry'), 'keep me');
    const calls: string[][] = [];
    const runner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'root') return globalRoot;
      if (args[0] === 'view') return '1.2.3';
      if (args[0] === 'config') return cacheRoot;
      if (args[0] === 'list') return JSON.stringify({ dependencies: { 'testorbit': { version: '1.2.3' } } });
      return '';
    };
    const log = vi.fn();

    const result = runSelfUpdate(packageRoot, runner, log);

    expect(result).toMatchObject({ success: true, updated: true, currentVersion: '1.0.0', latestVersion: '1.2.3', installedVersion: '1.2.3' });
    expect(calls).toContainEqual(['view', 'testorbit', 'version']);
    expect(calls).toContainEqual(['install', '--global', 'testorbit@latest']);
    expect(calls).toContainEqual(['config', 'get', 'cache']);
    expect(calls).toContainEqual(['list', '--global', '--depth=0', '--json']);
    expect(fs.existsSync(npxCache)).toBe(false);
    expect(fs.readFileSync(path.join(cacheRoot, 'other-cache-entry'), 'utf8')).toBe('keep me');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Cleared the npx execution cache'));
  });

  it('does not reinstall or clear cache when the installed version is already latest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-update-current-'));
    roots.push(root);
    const globalRoot = path.join(root, 'node_modules');
    const packageRoot = path.join(globalRoot, 'testorbit');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"version":"1.2.3"}');
    const calls: string[][] = [];
    const runner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'root') return globalRoot;
      if (args[0] === 'view') return '1.2.3';
      return '';
    };
    const result = runSelfUpdate(packageRoot, runner, vi.fn());
    expect(result).toMatchObject({ success: true, updated: false, installedVersion: '1.2.3' });
    expect(calls.some((args) => args[0] === 'install')).toBe(false);
    expect(calls.some((args) => args[0] === 'config')).toBe(false);
  });

  it('refuses to update a non-global npx or local checkout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-update-local-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
    const log = vi.fn();
    const runner = (args: string[]) => args[0] === 'root' ? path.join(root, 'global-node-modules') : '';
    const result = runSelfUpdate(root, runner, log);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Install it globally first');
  });
});
