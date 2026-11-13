/**
 * TestOrbit filesystem adapter (Part D, D1): every TestOrbit read/write goes
 * through here. Platform-wise storage: all TestOrbit data lives under
 * `<projectRoot>/.testorbit/<platform>/`, one folder per
 * platform, nothing outside the project folder.
 *
 * Writes are atomic (temp file + rename) and optionally keep a `.bak`
 * backup of the previous contents, so a crashed write never leaves a
 * half-written screen, variant, or test file behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_CONFIG_DIR } from '../../utils/paths.js';
import { TestOrbitError } from '../domain/errors.js';
import { isPlatform } from '../domain/types.js';
import type { Platform } from '../domain/types.js';

/**
 * Resolve the TestOrbit directory for one platform.
 *
 * @param projectRoot - Project root (absolute).
 * @param platform - Target platform (android | ios | flutter | web).
 * @returns `<projectRoot>/.testorbit/<platform>/`.
 * @throws TestOrbitError when the platform is not supported.
 */
export function getPlatformDir(projectRoot: string, platform: Platform): string {
  if (!isPlatform(platform)) {
    throw new TestOrbitError(
      'INVALID_PLATFORM',
      `Unsupported platform "${platform}": expected one of android, ios, flutter, web.`,
      'Pass a supported platform or check the project config.',
      { platform },
    );
  }
  return path.join(projectRoot, PROJECT_CONFIG_DIR, platform);
}

/**
 * Read a text file.
 *
 * @param filePath - Absolute file path.
 * @returns The file contents as UTF-8 text.
 * @throws TestOrbitError when the file cannot be read.
 */
export function readFileText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      'Check the path exists and is readable.',
      { filePath },
    );
  }
}

/**
 * List the names of a directory's immediate subdirectories, sorted.
 *
 * @param dir - Absolute directory path.
 * @returns Sorted subdirectory names, or [] when the directory is missing.
 */
export function listSubdirectories(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * List the names of a directory's immediate files, sorted.
 *
 * @param dir - Absolute directory path.
 * @returns Sorted file names, or [] when the directory is missing.
 */
export function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

/** Temporary sibling file used for one atomic write. */
function tempPathFor(filePath: string): string {
  return `${filePath}.tmp-${process.pid}-${Date.now()}`;
}

/**
 * Write a file atomically: the contents land in a temp sibling file and
 * are renamed over the target, so readers never see a partial file. The
 * parent directory is created when missing.
 *
 * @param filePath - Absolute target path.
 * @param contents - File contents.
 */
export function writeFileAtomic(filePath: string, contents: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = tempPathFor(filePath);
  fs.writeFileSync(tempPath, contents);
  fs.renameSync(tempPath, filePath);
}

/**
 * Write a file atomically, keeping a `.bak` copy of the previous contents
 * when the file already exists (safe re-learn, Phase 3).
 *
 * @param filePath - Absolute target path.
 * @param contents - File contents.
 * @returns The backup path, or null when no previous file existed.
 */
export function writeFileWithBackup(filePath: string, contents: string | Buffer): string | null {
  if (!fs.existsSync(filePath)) {
    writeFileAtomic(filePath, contents);
    return null;
  }
  const backupPath = `${filePath}.bak`;
  fs.copyFileSync(filePath, backupPath);
  writeFileAtomic(filePath, contents);
  return backupPath;
}
