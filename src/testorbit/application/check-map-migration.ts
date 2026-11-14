/**
 * Split/merge migration checks for `check-screen-map` (Phase 6, C16).
 *
 * Disappeared ids — element ids present in the previous learn's
 * `elements.json.bak` but absent from the current `elements.json` —
 * must appear either in a `mappings` entry (`from`) or in `removed`
 * of an explicit element-id migration list
 * (`docs/designs/screen-split-merge-migration.md`). Without one, the
 * checker fails naming the disappeared ids.
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkMigrationCoverage } from '../core/migration-check.js';
import { parseMigrationList } from '../domain/screen-map.js';
import type { CheckFinding, MigrationList } from '../domain/screen-map.js';
import { parseScreenElements } from '../domain/schemas.js';
import type { LearnedScreenElement, Platform, ScreenId } from '../domain/types.js';
import { getPlatformDir, listFiles } from '../infrastructure/filesystem.js';
import type { LoadedScreen } from './check-map-screen.js';
import { finding, readJsonFile } from './check-map-screen.js';

/** Load the migration lists of one screen leniently. */
function loadMigrationLists(screenDir: string, findings: CheckFinding[]): MigrationList[] {
  const lists: MigrationList[] = [];
  const migrationsDir = path.join(screenDir, 'migrations');
  for (const name of listFiles(migrationsDir).filter((entry) => entry.endsWith('.json'))) {
    const filePath = path.join(migrationsDir, name);
    try {
      lists.push(parseMigrationList(readJsonFile(filePath), filePath));
    } catch (error) {
      findings.push(
        finding(
          'MIGRATION_FILE_INVALID',
          'fail',
          `Migration list ${filePath} is invalid: ${error instanceof Error ? error.message : String(error)}`,
          'Fix the named field by hand; see docs/designs/screen-split-merge-migration.md.',
        ),
      );
    }
  }
  return lists;
}

/** Load the previous learn's elements (`.bak`), or null when unchecked. */
function previousElements(
  backupPath: string,
  screenId: ScreenId,
  findings: CheckFinding[],
): readonly LearnedScreenElement[] | null {
  if (!fs.existsSync(backupPath)) return null;
  try {
    return parseScreenElements(readJsonFile(backupPath), backupPath);
  } catch {
    findings.push(
      finding(
        'MIGRATION_BASELINE_UNREADABLE',
        'warn',
        `Previous elements.json.bak of screen "${screenId}" cannot be parsed, so disappeared ids cannot be checked against a migration list.`,
        'Re-learn the screen once so a fresh backup is written, or fix the backup file.',
        screenId,
      ),
    );
    return null;
  }
}

/** Turn a migration-coverage result into findings. */
function reportMigrationCoverage(
  screenId: ScreenId,
  result: ReturnType<typeof checkMigrationCoverage>,
  findings: CheckFinding[],
): void {
  if (result.uncovered.length > 0) {
    findings.push(
      finding(
        'SPLIT_MERGE_NO_MIGRATION',
        'fail',
        `Screen "${screenId}" lost element ids ${result.uncovered.join(', ')} between learns with no migration list covering them: a split/merge requires an explicit element-id migration list.`,
        `Write screens/${screenId}/migrations/<name>.json mapping each lost id to its successor (or listing it under "removed"); see docs/designs/screen-split-merge-migration.md.`,
        screenId,
      ),
    );
  }
  for (const problem of result.invalidMappings) {
    findings.push(
      finding('MIGRATION_INVALID', 'fail', problem, 'Fix the migration list by hand.', screenId),
    );
  }
}

/**
 * Check disappeared ids (previous learn's `.bak`) against the
 * migration lists of one screen.
 *
 * @param projectRoot - Project root (absolute).
 * @param platform - Target platform.
 * @param screen - Loaded screen to check.
 * @param loaded - All loaded screens (for migration target checks).
 * @param findings - Findings to append to.
 */
export function checkMigrationsFor(
  projectRoot: string,
  platform: Platform,
  screen: LoadedScreen,
  loaded: readonly LoadedScreen[],
  findings: CheckFinding[],
): void {
  const screenDir = path.join(getPlatformDir(projectRoot, platform), 'screens', screen.screenId);
  const previous = previousElements(path.join(screenDir, 'elements.json.bak'), screen.screenId, findings);
  if (previous === null) return;
  const currentByScreen = new Map(
    loaded.map((item) => [item.screenId, new Set(item.elements.map((element) => element.id))]),
  );
  const lists = loadMigrationLists(screenDir, findings);
  const result = checkMigrationCoverage(
    previous.map((element) => element.id),
    screen.elements.map((element) => element.id),
    lists,
    currentByScreen,
  );
  reportMigrationCoverage(screen.screenId, result, findings);
}
