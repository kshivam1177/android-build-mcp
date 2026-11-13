/**
 * Screen-map generator (Phase 6, C3) — reads the learned screens
 * (`screens/` bases + variants) and the recordings (schema v2, via the
 * one shared `recording-reader.ts`) and writes one
 * `<platform>/screen-map.json` (`schemaVersion: 2`).
 *
 * Stage 1 shipped the `screens/` folders themselves as the index (no
 * index file); this phase adds the generated map with edges. An edge
 * exists where a recording's navigation steps prove a transition:
 * the action that changed the matched `(screen, variant)` carries the
 * from-pair, the action type, and the element id, and the next action
 * carries the to-pair. v1 recordings carry no ids and yield no edges
 * ("unproven / start-stop only").
 *
 * Stale-edge rule (C3/C16): an edge whose `to` screen was re-learned
 * since its proving recording is marked stale until a newer recording
 * re-proves it. Re-learn is detected two ways: the `to` variant's
 * `learnedAt` is newer than the recording's `stoppedAt`, or the
 * `to` screen's `elements.json` mtime is newer than the recording
 * file's mtime. The generator never silently remaps ids across a
 * split/merge — edges are derived only from recorded ids.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseScreenMap } from '../domain/screen-map.js';
import type { ScreenMap, ScreenMapEdge } from '../domain/screen-map.js';
import { TestOrbitError } from '../domain/errors.js';
import { readRecordingFile } from '../infrastructure/recording-reader.js';
import type { TestOrbitRecordedAction, TestOrbitRecordingDocument } from '../domain/recording-schemas.js';
import type { ElementId, Platform, ScreenId, VariantId } from '../domain/types.js';
import { getPlatformDir, listFiles, writeFileAtomic } from '../infrastructure/filesystem.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import type { ScreenData } from '../infrastructure/variant-store.js';

/** Inputs to one map generation. */
export interface GenerateMapInput {
  projectRoot: string;
  platform: Platform;
}

/** Outcome of one map generation. */
export interface GenerateMapResult {
  map: ScreenMap;
  mapPath: string;
  warnings: readonly string[];
  recordingsRead: number;
  recordingsSkipped: number;
}

/** One candidate edge before de-duplication, with its proving recording. */
interface EdgeCandidate {
  fromScreen: ScreenId;
  fromVariant: VariantId;
  action: string;
  elementId: ElementId;
  toScreen: ScreenId;
  toVariant: VariantId;
  recordingId: string;
  stoppedAt: string;
}

/** De-duplication key for one transition (recordings are evidence, not identity). */
function edgeKey(candidate: EdgeCandidate): string {
  return [
    candidate.fromScreen,
    candidate.fromVariant,
    candidate.action,
    candidate.elementId,
    candidate.toScreen,
    candidate.toVariant,
  ].join('|');
}

/** True when the action carries the ids an edge needs. */
function actionHasIds(action: TestOrbitRecordedAction): boolean {
  return action.screenId !== undefined && action.variantId !== undefined;
}

/** True when consecutive actions change the matched (screen, variant). */
function isTransition(
  previous: TestOrbitRecordedAction,
  current: TestOrbitRecordedAction,
): boolean {
  if (current.isNavigationStep === true) return true;
  if (!actionHasIds(previous) || !actionHasIds(current)) return false;
  return previous.screenId !== current.screenId || previous.variantId !== current.variantId;
}

/**
 * Derive edge candidates from one v2 recording: each navigation step
 * contributes the causing action (from-pair, type, element id) and the
 * next action's to-pair. Transitions whose causing action has no
 * element id prove nothing and are skipped.
 */
function edgesOfRecording(recording: TestOrbitRecordingDocument): EdgeCandidate[] {
  const candidates: EdgeCandidate[] = [];
  for (let i = 1; i < recording.actions.length; i += 1) {
    const previous = recording.actions[i - 1] as TestOrbitRecordedAction;
    const current = recording.actions[i] as TestOrbitRecordedAction;
    if (!isTransition(previous, current)) continue;
    if (!actionHasIds(previous) || !actionHasIds(current)) continue;
    if (previous.elementId === undefined) continue;
    candidates.push({
      fromScreen: previous.screenId as ScreenId,
      fromVariant: previous.variantId as VariantId,
      action: previous.type,
      elementId: previous.elementId as ElementId,
      toScreen: current.screenId as ScreenId,
      toVariant: current.variantId as VariantId,
      recordingId: recording.flowId,
      stoppedAt: recording.stoppedAt,
    });
  }
  return candidates;
}

/** Last-learn time of a screen: newest variant `learnedAt` or elements mtime. */
function lastLearnMs(screen: ScreenData, projectRoot: string, platform: Platform): number {
  let latest = 0;
  for (const variant of screen.variants) {
    const at = Date.parse(variant.learnedAt);
    if (!Number.isNaN(at) && at > latest) latest = at;
  }
  const elementsPath = path.join(
    getPlatformDir(projectRoot, platform),
    'screens',
    screen.screenId,
    'elements.json',
  );
  try {
    const mtime = fs.statSync(elementsPath).mtimeMs;
    if (mtime > latest) latest = mtime;
  } catch {
    // No elements file: the variant stamps are the only signal.
  }
  return latest;
}

/** True when every proving recording predates the `to` screen's last learn. */
function isEdgeStale(
  candidate: EdgeCandidate,
  proving: readonly EdgeCandidate[],
  screens: readonly ScreenData[],
  projectRoot: string,
  platform: Platform,
): { stale: boolean; reason?: string } {
  const toScreen = screens.find((screen) => screen.screenId === candidate.toScreen);
  if (toScreen === undefined) return { stale: false };
  const learnedMs = lastLearnMs(toScreen, projectRoot, platform);
  if (learnedMs === 0) return { stale: false };
  const reproved = proving.some((proof) => Date.parse(proof.stoppedAt) >= learnedMs);
  if (reproved) return { stale: false };
  return {
    stale: true,
    reason:
      `screen "${candidate.toScreen}" was re-learned after recording ` +
      `"${proving.map((proof) => proof.recordingId).sort().join(', ')}" stopped; re-record a flow proving this transition.`,
  };
}

/** Merge candidates into de-duplicated edges with stale flags. */
function mergeEdges(
  candidates: readonly EdgeCandidate[],
  screens: readonly ScreenData[],
  projectRoot: string,
  platform: Platform,
): ScreenMapEdge[] {
  const grouped = new Map<string, EdgeCandidate[]>();
  for (const candidate of candidates) {
    const key = edgeKey(candidate);
    const bucket = grouped.get(key) ?? [];
    bucket.push(candidate);
    grouped.set(key, bucket);
  }
  const edges: ScreenMapEdge[] = [];
  for (const bucket of grouped.values()) {
    const first = bucket[0] as EdgeCandidate;
    const stale = isEdgeStale(first, bucket, screens, projectRoot, platform);
    const edge: ScreenMapEdge = {
      fromScreen: first.fromScreen,
      fromVariant: first.fromVariant,
      action: first.action,
      elementId: first.elementId,
      toScreen: first.toScreen,
      toVariant: first.toVariant,
      recordings: [...new Set(bucket.map((item) => item.recordingId))].sort(),
      stale: stale.stale,
    };
    if (stale.reason !== undefined) {
      edges.push({ ...edge, staleReason: stale.reason });
    } else {
      edges.push(edge);
    }
  }
  return edges.sort((left, right) =>
    `${left.fromScreen}|${left.fromVariant}|${left.toScreen}|${left.toVariant}`.localeCompare(
      `${right.fromScreen}|${right.fromVariant}|${right.toScreen}|${right.toVariant}`,
    ),
  );
}

/** Read one recording file; unparseable files are skipped with a warning. */
function readRecordingLenient(
  filePath: string,
  warnings: string[],
): { document: TestOrbitRecordingDocument; version: 1 | 2 } | null {
  try {
    return readRecordingFile(filePath);
  } catch (error) {
    warnings.push(
      `Skipped recording ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Read every recording in the folder and derive its edge candidates. */
function readEdgeCandidates(
  recordingsDir: string,
  warnings: string[],
): { candidates: EdgeCandidate[]; recordingsRead: number; recordingsSkipped: number } {
  const candidates: EdgeCandidate[] = [];
  let recordingsRead = 0;
  let recordingsSkipped = 0;
  for (const name of listFiles(recordingsDir).filter((entry) => entry.endsWith('.json'))) {
    const read = readRecordingLenient(path.join(recordingsDir, name), warnings);
    if (read === null) {
      recordingsSkipped += 1;
      continue;
    }
    recordingsRead += 1;
    if (read.version === 1) {
      warnings.push(
        `Recording "${read.document.flowId}" is schema v1 (unproven / start-stop only): no edges derived from it.`,
      );
      continue;
    }
    candidates.push(...edgesOfRecording(read.document));
  }
  return { candidates, recordingsRead, recordingsSkipped };
}

/** Assemble the map from the learned screens and derived edges. */
function buildScreenMap(
  platform: Platform,
  screens: readonly ScreenData[],
  edges: readonly ScreenMapEdge[],
): ScreenMap {
  const traversedScreens = new Set([...edges.map((edge) => edge.fromScreen), ...edges.map((edge) => edge.toScreen)]);
  const traversedVariants = new Set([
    ...edges.map((edge) => edge.fromVariant),
    ...edges.map((edge) => edge.toVariant),
  ]);
  return {
    schemaVersion: 2,
    platform,
    generatedAt: new Date().toISOString(),
    screens: screens
      .map((screen) => ({
        screenId: screen.screenId,
        variants: screen.variants.map((variant) => variant.variantId).sort(),
        elementCount: screen.baseElements.length,
      }))
      .sort((left, right) => left.screenId.localeCompare(right.screenId)),
    edges: [...edges],
    coverage: {
      screensLearned: screens.length,
      variantsLearned: screens.reduce((sum, screen) => sum + screen.variants.length, 0),
      edgeCount: edges.length,
      screensNeverTraversed: screens
        .map((screen) => screen.screenId)
        .filter((screenId) => !traversedScreens.has(screenId))
        .sort(),
      variantsNeverTraversed: screens
        .flatMap((screen) => screen.variants.map((variant) => variant.variantId))
        .filter((variantId) => !traversedVariants.has(variantId))
        .sort(),
    },
  };
}

/** Generate the screen map for one platform. */
export class GenerateMapUseCase {
  /**
   * Generate (or regenerate) `<platform>/screen-map.json`.
   *
   * @param input - Project root and platform.
   * @returns The validated map, its path, warnings, and recording counts.
   * @throws TestOrbitError when a learned screen or variant file is invalid.
   */
  generate(input: GenerateMapInput): GenerateMapResult {
    const store = new VariantStore(input.projectRoot, input.platform);
    const screens = store.loadAllScreens();
    const platformDir = getPlatformDir(input.projectRoot, input.platform);
    const warnings: string[] = [];
    const read = readEdgeCandidates(path.join(platformDir, 'recordings'), warnings);
    const edges = mergeEdges(read.candidates, screens, input.projectRoot, input.platform);
    const map = buildScreenMap(input.platform, screens, edges);
    const mapPath = path.join(platformDir, 'screen-map.json');
    writeFileAtomic(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    const validated = parseScreenMap(JSON.parse(JSON.stringify(map)) as unknown, mapPath);
    return { map: validated, mapPath, warnings, recordingsRead: read.recordingsRead, recordingsSkipped: read.recordingsSkipped };
  }
}

/** Build the map path for one platform (parse boundary for CLI/tool inputs). */
export function screenMapPathFor(projectRoot: string, platform: Platform): string {
  if (projectRoot.length === 0) {
    throw new TestOrbitError('INVALID_PROJECT_ROOT', 'Project root must not be empty.', 'Pass --project <path>.', {});
  }
  return path.join(getPlatformDir(projectRoot, platform), 'screen-map.json');
}
