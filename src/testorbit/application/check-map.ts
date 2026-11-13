/**
 * Screen-map checker (Phase 6, C3/C16) — `check-screen-map`.
 *
 * Validates the generated map and the learned screens against the
 * plan's checker rules, and reports every failure with the exact rule
 * violated and a remediation. Exit is non-zero when any `fail`
 * finding exists; warnings never fail the check.
 *
 * Rules (fail): dangling edge, screen folder with no map entry, map
 * entry for an unknown screen/variant, variant file invalid
 * (schemaVersion 2, non-empty required, fingerprintStamp present),
 * fingerprint stamp changed without re-learning, duplicate element
 * id in one screen's `elements.json`, stale edge (a re-learned `to`
 * screen whose incoming edges are not re-proved), split/merge
 * without an element-id migration list, variant count >10, two
 * variants with identical required+excluded sets (value change, not
 * a new variant), and the B3 scope rule (<80% of interactive elements
 * carrying a `resourceId` or unique `contentDesc`).
 *
 * Rules (warn, never fail): a screen with no edges ("learned, never
 * traversed"), a screen with >5 variants, a screen below 80% scope.
 *
 * Lenient screen loading lives in `check-map-screen.ts`: a bad
 * learned file becomes a finding naming it, so one broken screen
 * cannot hide the rest of the report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SCOPE_MIN_PCT, stableCoverage } from '../core/scope-coverage.js';
import { parseScreenMap } from '../domain/screen-map.js';
import type { CheckFinding, CheckMapReport, PerScreenCheck, ScreenMap, ScreenMapScreenEntry } from '../domain/screen-map.js';
import type { Platform } from '../domain/types.js';
import { getPlatformDir } from '../infrastructure/filesystem.js';
import { checkMigrationsFor } from './check-map-migration.js';
import { finding, loadLearnedScreens, readJsonFile } from './check-map-screen.js';
import type { LoadedScreen } from './check-map-screen.js';

/** Inputs to one map check. */
export interface CheckMapInput {
  projectRoot: string;
  platform: Platform;
}

/** Outcome of one map check: the report (exit 1 when it has failures). */
export interface CheckMapResult {
  report: CheckMapReport;
}

/** Check one map entry's variant list against the learned variants. */
function checkMapEntryVariants(
  entry: ScreenMapScreenEntry,
  screen: LoadedScreen,
  findings: CheckFinding[],
): void {
  const learnedVariants = new Set(screen.variants.map((variant) => variant.variantId));
  for (const variantId of entry.variants) {
    if (learnedVariants.has(variantId)) continue;
    findings.push(
      finding(
        'MAP_ENTRY_UNKNOWN_VARIANT',
        'fail',
        `screen-map.json lists variant "${variantId}" of screen "${entry.screenId}", which has no variant file.`,
        'Regenerate the map with orbit generate-map.',
        entry.screenId,
      ),
    );
  }
  for (const variant of screen.variants) {
    if (entry.variants.includes(variant.variantId)) continue;
    findings.push(
      finding(
        'MAP_ENTRY_MISSING_VARIANT',
        'fail',
        `screen-map.json has no entry for variant "${variant.variantId}" of screen "${entry.screenId}".`,
        'Regenerate the map with orbit generate-map.',
        entry.screenId,
      ),
    );
  }
}

/** Check map entries against the learned screens (both directions). */
function checkMapEntries(map: ScreenMap, loaded: readonly LoadedScreen[], findings: CheckFinding[]): void {
  const mapIds = new Set(map.screens.map((entry) => entry.screenId));
  for (const screen of loaded) {
    if (mapIds.has(screen.screenId)) continue;
    findings.push(
      finding(
        'SCREEN_WITHOUT_MAP_ENTRY',
        'fail',
        `Learned screen "${screen.screenId}" has no entry in screen-map.json: the map is out of date.`,
        'Regenerate the map with orbit generate-map.',
        screen.screenId,
      ),
    );
  }
  for (const entry of map.screens) {
    const screen = loaded.find((item) => item.screenId === entry.screenId);
    if (screen === undefined) {
      findings.push(
        finding(
          'MAP_ENTRY_UNKNOWN_SCREEN',
          'fail',
          `screen-map.json lists screen "${entry.screenId}", which has no learned folder.`,
          'Regenerate the map with orbit generate-map, or learn the screen.',
        ),
      );
      continue;
    }
    checkMapEntryVariants(entry, screen, findings);
  }
}

/** Check every edge: dangling endpoints and staleness. */
function checkEdges(map: ScreenMap, loaded: readonly LoadedScreen[], findings: CheckFinding[]): void {
  const byScreen = new Map(loaded.map((screen) => [screen.screenId, screen]));
  for (const edge of map.edges) {
    const fromScreen = byScreen.get(edge.fromScreen);
    const toScreen = byScreen.get(edge.toScreen);
    if (fromScreen === undefined || toScreen === undefined) {
      const missing = fromScreen === undefined ? edge.fromScreen : edge.toScreen;
      findings.push(
        finding(
          'DANGLING_EDGE',
          'fail',
          `Edge ${edge.fromScreen}/${edge.fromVariant} --${edge.action} ${edge.elementId}--> ${edge.toScreen}/${edge.toVariant} points at screen "${missing}", which has no learned folder.`,
          'Delete the screen from the map by regenerating it with orbit generate-map, or learn the screen.',
        ),
      );
      continue;
    }
    const fromKnown = fromScreen.variants.some((variant) => variant.variantId === edge.fromVariant);
    const toKnown = toScreen.variants.some((variant) => variant.variantId === edge.toVariant);
    if (!fromKnown || !toKnown) {
      findings.push(
        finding(
          'DANGLING_EDGE',
          'fail',
          `Edge ${edge.fromScreen}/${edge.fromVariant} --${edge.action} ${edge.elementId}--> ${edge.toScreen}/${edge.toVariant} points at a variant with no variant file.`,
          'Regenerate the map with orbit generate-map, or learn the variant.',
        ),
      );
      continue;
    }
    if (edge.stale) {
      findings.push(
        finding(
          'STALE_EDGE',
          'fail',
          `Edge ${edge.fromScreen}/${edge.fromVariant} --${edge.action} ${edge.elementId}--> ${edge.toScreen}/${edge.toVariant} is stale: ${edge.staleReason ?? `screen "${edge.toScreen}" was re-learned since its proving recording.`}`,
          'Re-record a flow proving this transition, then regenerate the map with orbit generate-map.',
        ),
      );
    }
  }
}

/** Load the map leniently; a missing or invalid map becomes one finding. */
function loadMap(
  projectRoot: string,
  platform: Platform,
  findings: CheckFinding[],
): ScreenMap | null {
  const mapPath = path.join(getPlatformDir(projectRoot, platform), 'screen-map.json');
  if (!fs.existsSync(mapPath)) {
    findings.push(
      finding(
        'MAP_MISSING',
        'fail',
        `No screen-map.json at ${mapPath}: the map has never been generated.`,
        'Generate the map with orbit generate-map.',
      ),
    );
    return null;
  }
  try {
    return parseScreenMap(readJsonFile(mapPath), mapPath);
  } catch (error) {
    findings.push(
      finding(
        'MAP_INVALID',
        'fail',
        `screen-map.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
        'Regenerate the map with orbit generate-map.',
      ),
    );
    return null;
  }
}

/** Fail when pooled stable coverage is below the 80% v1 scope rule. */
function checkOverallScope(loaded: readonly LoadedScreen[], findings: CheckFinding[]): void {
  const pooled = stableCoverage(loaded.flatMap((screen) => screen.elements));
  if (loaded.length === 0 || pooled.pct >= SCOPE_MIN_PCT) return;
  findings.push(
    finding(
      'SCOPE_BELOW_80',
      'fail',
      `Stable coverage is ${pooled.pct}% overall (${pooled.covered} of ${pooled.total} interactive elements carry a resourceId or unique contentDesc): below the 80% v1 scope rule.`,
      'Add resourceIds or unique contentDescs to the app, or record the app as out of v1 scope.',
    ),
  );
}

/** Per-screen report entries, with edge counts from the map (0 when absent). */
function perScreenChecks(
  loaded: readonly LoadedScreen[],
  map: ScreenMap | null,
): PerScreenCheck[] {
  return loaded.map((screen) => {
    const edges = map === null ? [] : map.edges.filter((edge) => edge.fromScreen === screen.screenId || edge.toScreen === screen.screenId);
    const coverage = stableCoverage(screen.elements);
    return {
      screenId: screen.screenId,
      elementCount: screen.elements.length,
      stableCoveragePct: coverage.pct,
      variantCount: screen.variants.length,
      edgeCount: edges.length,
      traversed: edges.length > 0,
    };
  });
}

/** Warn (never fail) on screens with no edges. */
function warnUntraversed(checks: readonly PerScreenCheck[], findings: CheckFinding[]): void {
  for (const check of checks) {
    if (check.traversed) continue;
    findings.push(
      finding(
        'MISSING_EDGE',
        'warn',
        `Screen "${check.screenId}" is learned but never traversed: no recording proves a transition in or out of it.`,
        'Record a flow through this screen, then regenerate the map.',
        check.screenId,
      ),
    );
  }
}

/** Check the screen map and learned screens for one platform. */
export class CheckMapUseCase {
  /**
   * Run `check-screen-map`.
   *
   * @param input - Project root and platform.
   * @returns The report; `passed` is false when any `fail` finding exists.
   */
  check(input: CheckMapInput): CheckMapResult {
    const findings: CheckFinding[] = [];
    const loaded = loadLearnedScreens(input.projectRoot, input.platform, findings);
    for (const screen of loaded) {
      checkMigrationsFor(input.projectRoot, input.platform, screen, loaded, findings);
    }
    checkOverallScope(loaded, findings);
    const map = loadMap(input.projectRoot, input.platform, findings);
    if (map !== null) {
      checkMapEntries(map, loaded, findings);
      checkEdges(map, loaded, findings);
    }
    const checks = perScreenChecks(loaded, map);
    warnUntraversed(checks, findings);
    const report: CheckMapReport = {
      schemaVersion: 2,
      platform: input.platform,
      checkedAt: new Date().toISOString(),
      passed: !findings.some((entry) => entry.severity === 'fail'),
      findings,
      screens: checks,
    };
    return { report };
  }
}
