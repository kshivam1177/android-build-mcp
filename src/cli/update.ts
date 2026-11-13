import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type NpmRunner = (args: string[], inheritOutput?: boolean) => string;

export function isPathInsideDirectory(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function readPackageVersion(packageJsonText: string): string | undefined {
  try {
    const parsed = JSON.parse(packageJsonText) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function parseVersion(version: string): { major: number; minor: number; patch: number; prerelease: string[] } | undefined {
  const match = version.trim().replace(/^v/, '').match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** Compare valid semantic versions; returns undefined for non-semver inputs. */
export function compareVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return undefined;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) return Number(ai) > Number(bi) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ai > bi ? 1 : -1;
  }
  return 0;
}

function defaultNpmRunner(args: string[], inheritOutput = false): string {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: inheritOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    // npm is a .cmd shim on Windows. All arguments here are fixed by this module.
    shell: process.platform === 'win32',
  });
  return typeof output === 'string' ? output.trim() : '';
}

function canonicalPath(candidate: string): string {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function clearNpxCache(runner: NpmRunner): void {
  // Ask npm for its configured cache path so this also works on Windows and
  // when npm_config_cache overrides the default ~/.npm location.
  const cacheRoot = runner(['config', 'get', 'cache']).trim();
  if (!cacheRoot || cacheRoot === 'undefined' || cacheRoot === 'null') {
    throw new Error('npm did not return a valid cache directory');
  }
  const npxCachePath = path.join(cacheRoot, '_npx');
  fs.rmSync(npxCachePath, { recursive: true, force: true });
}

export interface UpdateResult {
  success: boolean;
  updated?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  installedVersion?: string;
  message: string;
}

/**
 * Update the global npm installation only when the registry has a newer
 * version. Clear only npm's npx execution cache, not the shared npm package
 * download cache used by unrelated Node.js projects.
 */
export function runSelfUpdate(
  packageRoot: string,
  runner: NpmRunner = defaultNpmRunner,
  log: (message: string) => void = console.log,
): UpdateResult {
  let currentVersion: string | undefined;
  try {
    currentVersion = readPackageVersion(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  } catch {
    // The global root check below will provide the actionable error.
  }

  let globalRoot: string;
  try {
    globalRoot = runner(['root', '--global']);
  } catch {
    return { success: false, currentVersion, message: 'Could not locate the global npm installation. Ensure npm is installed and available on PATH.' };
  }

  const resolvedPackageRoot = canonicalPath(packageRoot);
  const resolvedGlobalRoot = canonicalPath(globalRoot);
  if (!isPathInsideDirectory(resolvedPackageRoot, resolvedGlobalRoot)) {
    const message = 'This command is not running from the global npm installation. Install it globally first with: npm install -g testorbit@latest';
    log(message);
    return { success: false, currentVersion, message };
  }

  let latestVersion: string;
  try {
    latestVersion = runner(['view', 'testorbit', 'version']).trim();
    if (!latestVersion) throw new Error('empty version response');
  } catch {
    const message = 'Could not reach the npm registry to determine the latest version. No update was attempted.';
    log(message);
    return { success: false, currentVersion, message };
  }

  if (!currentVersion) {
    const message = 'Could not read the installed package version. No update was attempted.';
    log(message);
    return { success: false, latestVersion, message };
  }

  const comparison = compareVersions(latestVersion, currentVersion);
  if (comparison === undefined) {
    const message = `Could not compare installed version ${currentVersion} with registry version ${latestVersion}; no update was attempted.`;
    log(message);
    return { success: false, currentVersion, latestVersion, message };
  }
  if (comparison <= 0) {
    const message = `testorbit ${currentVersion} is already up to date (registry latest: ${latestVersion}). No installation or cache cleanup was needed.`;
    log(message);
    return { success: true, updated: false, currentVersion, latestVersion, installedVersion: currentVersion, message };
  }

  log(`Updating testorbit: ${currentVersion} -> ${latestVersion}...`);
  try {
    runner(['install', '--global', 'testorbit@latest'], true);
  } catch {
    const message = 'npm could not install the latest version. The existing installation was not deliberately uninstalled first; check npm permissions/network and retry.';
    log(message);
    return { success: false, currentVersion, latestVersion, message };
  }

  let cacheWarning = '';
  try {
    clearNpxCache(runner);
  } catch (err) {
    cacheWarning = ` Warning: the package was updated, but npx cache cleanup failed: ${(err as Error).message}`;
  }

  let installedVersion: string | undefined;
  try {
    const output = runner(['list', '--global', '--depth=0', '--json']);
    const parsed = JSON.parse(output) as {
      dependencies?: Record<string, { version?: string }>;
    };
    installedVersion = parsed.dependencies?.['testorbit']?.version;
  } catch {
    try {
      const installedPackageJson = path.join(globalRoot, 'testorbit', 'package.json');
      installedVersion = readPackageVersion(fs.readFileSync(installedPackageJson, 'utf8'));
    } catch {
      // Keep the verification failure visible in the result below.
    }
  }

  if (!installedVersion) {
    const message = 'The install command completed, but the installed version could not be verified.' + cacheWarning;
    log(message);
    return { success: false, updated: true, currentVersion, latestVersion, message };
  }
  if (installedVersion !== latestVersion) {
    const message = `Installed version ${installedVersion} does not match npm's latest version ${latestVersion}. Retry the update and inspect npm permissions or registry configuration.` + cacheWarning;
    log(message);
    return { success: false, updated: true, currentVersion, latestVersion, installedVersion, message };
  }

  const message = `Updated testorbit from ${currentVersion} to ${installedVersion}. The previous global version was replaced. Cleared the npx execution cache at the configured npm cache directory.` + cacheWarning;
  log(message);
  return { success: true, updated: true, currentVersion, latestVersion, installedVersion, message };
}
