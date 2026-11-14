/**
 * Split/merge migration coverage (Phase 6, C16) — pure logic for the
 * checker rule in `docs/designs/screen-split-merge-migration.md`.
 *
 * When a logical screen splits or merges, element ids change (they
 * are prefixed with the screen id, B3). The change is only safe with
 * an explicit element-id migration list: every id that disappears
 * from a screen between learns must appear either in a `mappings`
 * entry (`from`) or in `removed`, and every `mappings` entry's `to`
 * id must exist in the target screen's `elements.json` while its
 * `from` id must no longer exist there.
 */
import type { MigrationList } from '../domain/screen-map.js';
import type { ElementId, ScreenId } from '../domain/types.js';

/** Outcome of checking disappeared ids against the migration lists. */
export interface MigrationCheckResult {
  /** Disappeared ids with neither a mapping nor a `removed` entry. */
  uncovered: readonly ElementId[];
  /** Human-readable problems with the migration lists themselves. */
  invalidMappings: readonly string[];
}

/** Ids that disappear between the previous and current element sets. */
function disappearedIds(
  previous: readonly ElementId[],
  current: readonly ElementId[],
): ElementId[] {
  const currentSet = new Set(current);
  return previous.filter((id) => !currentSet.has(id)).sort();
}

/** Validate one migration list's mappings against the learned screens. */
function invalidMappingsOf(
  list: MigrationList,
  currentByScreen: ReadonlyMap<ScreenId, ReadonlySet<ElementId>>,
): string[] {
  const problems: string[] = [];
  const fromElements = currentByScreen.get(list.fromScreen) ?? new Set<ElementId>();
  for (const pair of list.mappings) {
    if (fromElements.has(pair.from)) {
      problems.push(
        `migration "${list.migration}": "${pair.from}" is still present on screen "${list.fromScreen}" — a mapping's "from" id must no longer exist there.`,
      );
    }
    const targetKnown = list.toScreens.some((screenId) =>
      (currentByScreen.get(screenId) ?? new Set<ElementId>()).has(pair.to),
    );
    if (!targetKnown) {
      problems.push(
        `migration "${list.migration}": "${pair.to}" does not exist in any target screen's elements.json (${list.toScreens.join(', ')}).`,
      );
    }
  }
  return problems;
}

/**
 * Check disappeared ids against the migration lists for one screen.
 *
 * @param previousIds - Element ids of the previous learn (`.bak` file).
 * @param currentIds - Element ids of the current `elements.json`.
 * @param lists - Migration lists found for this screen.
 * @param currentByScreen - Current element ids per screen, for target checks.
 * @returns Uncovered disappeared ids and invalid-mapping problems.
 */
export function checkMigrationCoverage(
  previousIds: readonly ElementId[],
  currentIds: readonly ElementId[],
  lists: readonly MigrationList[],
  currentByScreen: ReadonlyMap<ScreenId, ReadonlySet<ElementId>>,
): MigrationCheckResult {
  const disappeared = disappearedIds(previousIds, currentIds);
  if (disappeared.length === 0) return { uncovered: [], invalidMappings: [] };
  const covered = new Set<ElementId>();
  const invalidMappings: string[] = [];
  for (const list of lists) {
    for (const pair of list.mappings) covered.add(pair.from);
    for (const id of list.removed) covered.add(id);
    invalidMappings.push(...invalidMappingsOf(list, currentByScreen));
  }
  return {
    uncovered: disappeared.filter((id) => !covered.has(id)),
    invalidMappings,
  };
}
