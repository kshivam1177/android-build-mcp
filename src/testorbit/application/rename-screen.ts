/**
 * Rename-screen (Phase 6, D11) — renames a screen id and rewrites
 * EVERYTHING that references it: the screen directory, its variant
 * files (including their file names), `screen.json`, `elements.json`,
 * `form-spec.json`, migration lists, every `screenId`/`variantId`/
 * `elementId` in `recordings/`, every step in `testcases/` (plus the
 * `${TEST_<SCREEN>_...}` env-var names in test cases, `.env.example`
 * files, and generated YAML), and then regenerates the map.
 *
 * Atomic-ish: every file to be rewritten is copied into a backup
 * directory first, and every file is read, parsed, and rewritten in
 * memory before anything is written. If any reference cannot be
 * rewritten (an unparseable file) the rename aborts before writing
 * anything; if a write fails mid-apply, the backup is restored and
 * the error names the backup path, so a half-renamed state never
 * stands without a backup to restore from.
 *
 * What is NOT rewritten: the app's real `appRoute` (it is the app's
 * route, not derived from the screen id), recording `flowId`s, test
 * ids, and resourceIds/contentDescs (stable selectors are unchanged
 * by a screen rename). Variant files get a fresh `fingerprintStamp`
 * after relabelling — the stamp is a hash over the screen/variant
 * ids and the element sets, so the old stamp would fail
 * `check-screen-map` after any rename. Stale `.bak` backups of the
 * renamed screen are deleted — they reference the old ids and would
 * trip the split/merge migration check; the rename backup itself
 * preserves the old state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GenerateMapUseCase } from './generate-map.js';
import { TestOrbitError } from '../domain/errors.js';
import type { Platform, ScreenId } from '../domain/types.js';
import { deepRewrite, refreshVariantStamp, relabelEnvVars, screaming } from './screen-references.js';
import type { PlannedRewrite } from './screen-references.js';
import { getPlatformDir, writeFileAtomic } from '../infrastructure/filesystem.js';

/** Inputs to a screen rename. */
export interface RenameScreenInput {
  projectRoot: string;
  platform: Platform;
  fromScreenId: ScreenId;
  toScreenId: ScreenId;
}

/** Outcome of a screen rename. */
export interface RenameScreenResult {
  fromScreenId: ScreenId;
  toScreenId: ScreenId;
  /** Backup directory holding the pre-rename files; kept after success. */
  backupPath: string;
  /** Platform-relative paths of every rewritten file. */
  rewrittenFiles: readonly string[];
  /** Path of the regenerated screen map. */
  mapPath: string;
}

/** Parse one JSON file; an unparseable file aborts the rename. */
function parseJsonForRename(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Cannot rename: could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the file or remove it, then retry the rename.',
      { filePath },
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Cannot rename: ${filePath} is not valid JSON and its references cannot be rewritten: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the file by hand or re-learn the screen, then retry the rename.',
      { filePath },
    );
  }
}

/** Recursively collect every file under a directory, sorted. */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Plan the rewrite of one JSON file (parse + deep rewrite). */
function planJsonRewrite(
  filePath: string,
  from: string,
  to: string,
  fromUpper: string,
  toUpper: string,
): PlannedRewrite {
  const rewritten = deepRewrite(parseJsonForRename(filePath), from, to, fromUpper, toUpper);
  return { filePath, contents: `${JSON.stringify(rewritten, null, 2)}\n` };
}

/** Plan the rewrite of one text file (env-var prefix only). */
function planTextRewrite(filePath: string, fromUpper: string, toUpper: string): PlannedRewrite {
  const raw = fs.readFileSync(filePath, 'utf8');
  return { filePath, contents: relabelEnvVars(raw, fromUpper, toUpper) };
}

/** Plan every rewrite: screen dir, recordings, test cases, YAML/env files. */
function planRenames(input: RenameScreenInput): { plan: PlannedRewrite[]; bakFiles: string[] } {
  const platformDir = getPlatformDir(input.projectRoot, input.platform);
  const fromDir = path.join(platformDir, 'screens', input.fromScreenId);
  const fromUpper = screaming(input.fromScreenId);
  const toUpper = screaming(input.toScreenId);
  const plan: PlannedRewrite[] = [];
  const bakFiles: string[] = [];
  for (const filePath of collectFiles(fromDir)) {
    if (filePath.endsWith('.bak')) {
      bakFiles.push(filePath);
      continue;
    }
    const rewrite = filePath.endsWith('.json')
      ? planJsonRewrite(filePath, input.fromScreenId, input.toScreenId, fromUpper, toUpper)
      : planTextRewrite(filePath, fromUpper, toUpper);
    const variantsDir = path.join(fromDir, 'variants');
    const isVariantFile = filePath.startsWith(`${variantsDir}${path.sep}`) && filePath.endsWith('.json');
    if (isVariantFile) {
      const stamped = refreshVariantStamp(rewrite);
      rewrite.contents = stamped.contents;
    }
    if (isVariantFile && path.basename(filePath).startsWith(`${input.fromScreenId}.`)) {
      rewrite.renameTo = path.join(
        variantsDir,
        `${input.toScreenId}.${path.basename(filePath).slice(input.fromScreenId.length + 1)}`,
      );
    }
    plan.push(rewrite);
  }
  for (const subdir of ['recordings', 'testcases']) {
    for (const filePath of collectFiles(path.join(platformDir, subdir))) {
      if (!filePath.endsWith('.json')) continue;
      plan.push(planJsonRewrite(filePath, input.fromScreenId, input.toScreenId, fromUpper, toUpper));
    }
  }
  for (const filePath of collectFiles(path.join(platformDir, 'tests'))) {
    if (filePath.endsWith('.yaml')) plan.push(planTextRewrite(filePath, fromUpper, toUpper));
  }
  for (const filePath of collectFiles(path.join(platformDir, 'testcases'))) {
    if (filePath.endsWith('.env.example')) plan.push(planTextRewrite(filePath, fromUpper, toUpper));
  }
  return { plan, bakFiles };
}

/** Copy one file into the backup dir, preserving its platform-relative path. */
function backupFile(backupDir: string, platformDir: string, filePath: string): void {
  const relative = path.relative(platformDir, filePath);
  const target = path.join(backupDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(filePath, target);
}

/** Copy a whole directory into the backup dir (the screen folder). */
function backupScreenDir(backupDirPath: string, platformDir: string, dir: string): void {
  const relative = path.relative(platformDir, dir);
  fs.mkdirSync(path.join(backupDirPath, relative), { recursive: true });
  fs.cpSync(dir, path.join(backupDirPath, relative), { recursive: true });
}

/** Restore every backed-up file and remove the half-renamed screen dir. */
function restoreFromBackup(
  backupDir: string,
  platformDir: string,
  fromDir: string,
  toDir: string,
  mapExisted: boolean,
): void {
  if (fs.existsSync(toDir)) fs.rmSync(toDir, { recursive: true, force: true });
  if (fs.existsSync(fromDir)) fs.rmSync(fromDir, { recursive: true, force: true });
  const backedUpScreen = path.join(backupDir, 'screens', path.basename(fromDir));
  if (fs.existsSync(backedUpScreen)) {
    fs.mkdirSync(path.dirname(fromDir), { recursive: true });
    fs.cpSync(backedUpScreen, fromDir, { recursive: true });
  }
  for (const filePath of collectFiles(backupDir)) {
    const relative = path.relative(backupDir, filePath);
    if (relative.startsWith(`screens${path.sep}`)) continue;
    if (relative === 'backup-manifest.json') continue;
    const target = path.join(platformDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(filePath, target);
  }
  const mapPath = path.join(platformDir, 'screen-map.json');
  if (!mapExisted && fs.existsSync(mapPath)) fs.rmSync(mapPath, { force: true });
}

/** Validate the rename before any planning: old exists, new is free. */
function validateRename(input: RenameScreenInput, fromDir: string, toDir: string): void {
  if (input.fromScreenId === input.toScreenId) {
    throw new TestOrbitError(
      'INVALID_RENAME',
      `Cannot rename screen "${input.fromScreenId}" to itself.`,
      'Pass a different --to screen id.',
      { screenId: input.fromScreenId },
    );
  }
  if (!fs.existsSync(fromDir)) {
    throw new TestOrbitError(
      'SCREEN_NOT_FOUND',
      `Cannot rename: screen "${input.fromScreenId}" has no learned folder in ${fromDir}.`,
      'Learn the screen first, or check the screen id.',
      { screenId: input.fromScreenId },
    );
  }
  if (fs.existsSync(toDir)) {
    throw new TestOrbitError(
      'SCREEN_ALREADY_EXISTS',
      `Cannot rename: screen "${input.toScreenId}" already has a learned folder in ${toDir}.`,
      'Pick a different --to screen id, or merge the screens first.',
      { screenId: input.toScreenId },
    );
  }
}

/** Rename a screen id and rewrite every reference to it. */
export class RenameScreenUseCase {
  /**
   * Rename a screen.
   *
   * @param input - Project, platform, old and new screen ids.
   * @returns The backup path, rewritten files, and regenerated map path.
   * @throws TestOrbitError when the old screen does not exist, the new id
   *   is taken, or any reference cannot be rewritten — in which case
   *   the backup is restored and the backup path is named.
   */
  rename(input: RenameScreenInput): RenameScreenResult {
    const platformDir = getPlatformDir(input.projectRoot, input.platform);
    const fromDir = path.join(platformDir, 'screens', input.fromScreenId);
    const toDir = path.join(platformDir, 'screens', input.toScreenId);
    validateRename(input, fromDir, toDir);
    const { plan, bakFiles } = planRenames(input);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(platformDir, `.rename-backup-${input.fromScreenId}-${stamp}`);
    const mapPath = path.join(platformDir, 'screen-map.json');
    const mapExisted = fs.existsSync(mapPath);
    let backupReady = false;
    try {
      createBackup(backupDir, platformDir, fromDir, plan, mapPath, mapExisted);
      backupReady = true;
      this.applyPlan(plan, bakFiles, fromDir, toDir);
      const generated = new GenerateMapUseCase().generate({ projectRoot: input.projectRoot, platform: input.platform });
      return {
        fromScreenId: input.fromScreenId,
        toScreenId: input.toScreenId,
        backupPath: backupDir,
        rewrittenFiles: [...plan.map((item) => path.relative(platformDir, item.filePath)), 'screen-map.json'],
        mapPath: generated.mapPath,
      };
    } catch (error) {
      if (backupReady) restoreFromBackup(backupDir, platformDir, fromDir, toDir, mapExisted);
      const detail = error instanceof Error ? error.message : String(error);
      throw new TestOrbitError(
        'RENAME_FAILED',
        `Rename failed${backupReady ? ` and the pre-rename state was restored from ${backupDir}` : ' before any file was written'}: ${detail}`,
        `Fix the cause, then retry the rename; the backup in ${backupDir} holds the original files.`,
        { screenId: input.fromScreenId, backupPath: backupDir },
      );
    }
  }

  /** Write every planned rewrite, rename variant files, drop `.bak`s, move the dir. */
  private applyPlan(
    plan: readonly PlannedRewrite[],
    bakFiles: readonly string[],
    fromDir: string,
    toDir: string,
  ): void {
    for (const item of plan) {
      if (!item.filePath.startsWith(`${fromDir}${path.sep}`)) continue;
      writeFileAtomic(item.filePath, item.contents);
    }
    for (const item of plan) {
      if (item.renameTo === undefined) continue;
      fs.renameSync(item.filePath, item.renameTo);
    }
    for (const bakFile of bakFiles) fs.rmSync(bakFile, { force: true });
    fs.renameSync(fromDir, toDir);
    for (const item of plan) {
      if (item.filePath.startsWith(`${fromDir}${path.sep}`)) continue;
      writeFileAtomic(item.filePath, item.contents);
    }
  }
}

/** Back up the screen folder, every planned file, and the map (when present). */
function createBackup(
  backupDirPath: string,
  platformDir: string,
  fromDir: string,
  plan: readonly PlannedRewrite[],
  mapPath: string,
  mapExisted: boolean,
): void {
  fs.mkdirSync(backupDirPath, { recursive: true });
  backupScreenDir(backupDirPath, platformDir, fromDir);
  for (const item of plan) {
    if (item.filePath.startsWith(`${fromDir}${path.sep}`)) continue;
    if (fs.existsSync(item.filePath)) backupFile(backupDirPath, platformDir, item.filePath);
  }
  if (mapExisted) backupFile(backupDirPath, platformDir, mapPath);
  const manifest = {
    createdAt: new Date().toISOString(),
    files: plan.map((item) => path.relative(platformDir, item.filePath)),
  };
  fs.writeFileSync(path.join(backupDirPath, 'backup-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
