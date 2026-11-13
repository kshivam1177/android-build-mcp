import fs from 'node:fs';
import path from 'node:path';
import { execCommand } from './exec.js';
import { loadConfig } from '../config/loader.js';
import { TestOrbitFrameworkError } from '../types.js';

export function resolveAndroidHome(): string {
  const configured = loadConfig().paths.androidHome;
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const home = configured || fromEnv;
  if (!home) {
    throw new TestOrbitFrameworkError(
      'ANDROID_HOME_NOT_SET',
      'Neither paths.androidHome (config.yaml) nor ANDROID_HOME/ANDROID_SDK_ROOT is set.'
    );
  }
  return home;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Picks the highest-versioned build-tools directory under $ANDROID_HOME. */
export function findAapt2(): string {
  const androidHome = resolveAndroidHome();
  const buildToolsDir = path.join(androidHome, 'build-tools');
  if (!fs.existsSync(buildToolsDir)) {
    throw new TestOrbitFrameworkError(
      'FILE_NOT_FOUND',
      `No build-tools directory at ${buildToolsDir}. Install one with: sdkmanager "build-tools;<version>"`
    );
  }
  const versions = fs
    .readdirSync(buildToolsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(compareVersions);
  const latest = versions[versions.length - 1];
  if (!latest) {
    throw new TestOrbitFrameworkError('FILE_NOT_FOUND', `${buildToolsDir} exists but has no version subdirectories.`);
  }
  const binName = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const aapt2Path = path.join(buildToolsDir, latest, binName);
  if (!fs.existsSync(aapt2Path)) {
    throw new TestOrbitFrameworkError('FILE_NOT_FOUND', `aapt2 not found at ${aapt2Path}.`);
  }
  return aapt2Path;
}

export interface ApkInfo {
  packageName: string;
  versionCode?: string;
  versionName?: string;
  launchableActivity?: string;
  minSdkVersion?: string;
  targetSdkVersion?: string;
}

/** Reads package name + launchable activity straight from the built artifact
 * via `aapt2 dump badging`, rather than parsing build.gradle DSL (which
 * can't resolve variables, version catalogs, or applied conventions
 * plugins reliably). */
export async function inspectApk(apkPath: string): Promise<ApkInfo> {
  if (!fs.existsSync(apkPath)) {
    throw new TestOrbitFrameworkError('FILE_NOT_FOUND', `No APK at ${apkPath}. Build the variant first.`);
  }
  const aapt2 = findAapt2();
  const result = await execCommand(aapt2, ['dump', 'badging', apkPath], { timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    throw new TestOrbitFrameworkError(
      'COMMAND_FAILED',
      `aapt2 dump badging failed for ${apkPath}: ${result.stderr.slice(0, 1000)}`
    );
  }
  const out = result.stdout;
  const packageMatch = out.match(/package: name='([^']+)' versionCode='([^']*)' versionName='([^']*)'/);
  const launchMatch = out.match(/launchable-activity: name='([^']+)'/);
  const minSdkMatch = out.match(/sdkVersion:'([^']+)'/);
  const targetSdkMatch = out.match(/targetSdkVersion:'([^']+)'/);

  if (!packageMatch) {
    throw new TestOrbitFrameworkError('COMMAND_FAILED', `Could not parse package name from aapt2 output for ${apkPath}.`, {
      stdout: out.slice(0, 2000),
    });
  }

  return {
    packageName: packageMatch[1] as string,
    versionCode: packageMatch[2],
    versionName: packageMatch[3],
    launchableActivity: launchMatch?.[1],
    minSdkVersion: minSdkMatch?.[1],
    targetSdkVersion: targetSdkMatch?.[1],
  };
}

/**
 * Gradle module path (":app", ":features:login", ":" for root) -> filesystem
 * directory, assuming the conventional 1:1 mapping Gradle uses. Doesn't
 * detect a settings.gradle that explicitly remaps a project's projectDir -
 * real but uncommon.
 */
export function moduleDirFromPath(projectRoot: string, modulePath: string): string {
  const trimmed = modulePath.trim();
  if (trimmed === '' || trimmed === ':') return projectRoot;
  const segments = trimmed.split(':').filter((s) => s.length > 0);
  return path.join(projectRoot, ...segments);
}

/**
 * Searches <moduleDir>/build/outputs/apk/** for the most-recently-built APK
 * whose filename contains `variant` (case-insensitive). More resilient than
 * hard-coding AGP's flavor/buildType output-folder convention, which shifts
 * with flavor dimensions and signing-config suffixes.
 */
export function findBuiltApk(moduleDir: string, variant: string): string {
  const apkRoot = path.join(moduleDir, 'build', 'outputs', 'apk');
  if (!fs.existsSync(apkRoot)) {
    throw new TestOrbitFrameworkError(
      'FILE_NOT_FOUND',
      `No build/outputs/apk under ${moduleDir} yet. Run build_device (or build_run_device) for variant "${variant}" first.`
    );
  }
  const matches: { file: string; mtimeMs: number }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.apk') &&
        entry.name.toLowerCase().includes(variant.toLowerCase())
      ) {
        matches.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs });
      }
    }
  };
  walk(apkRoot);
  if (matches.length === 0) {
    throw new TestOrbitFrameworkError(
      'FILE_NOT_FOUND',
      `No .apk under ${apkRoot} matches variant "${variant}". Build it first.`
    );
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return (matches[0] as { file: string; mtimeMs: number }).file;
}
