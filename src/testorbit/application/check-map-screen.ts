/**
 * Lenient learned-screen loading for `check-screen-map` (Phase 6).
 *
 * The checker must never throw on a bad learned file: each bad file
 * becomes a finding naming it, so one broken screen cannot hide the
 * rest of the report. This module loads screens and variant files
 * that way, and checks disappeared ids (previous learn's `.bak`)
 * against the split/merge migration lists (C16).
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeVariantFingerprintStamp } from '../core/fingerprint.js';
import { SCOPE_MIN_PCT, stableCoverage } from '../core/scope-coverage.js';
import type { CheckFinding } from '../domain/screen-map.js';
import { TestOrbitError } from '../domain/errors.js';
import { parseScreenElements, parseVariantDefinition } from '../domain/schemas.js';
import type { ElementId, LearnedScreenElement, Platform, ScreenId, VariantDefinition } from '../domain/types.js';
import { toScreenId } from '../domain/types.js';
import { getPlatformDir, listFiles, listSubdirectories, readFileText } from '../infrastructure/filesystem.js';
import { VARIANT_FAIL_THRESHOLD, VARIANT_FLAG_THRESHOLD } from './learn-screen.js';

/** One loaded screen, leniently: bad files become findings, not throws. */
export interface LoadedScreen {
  screenId: ScreenId;
  elements: readonly LearnedScreenElement[];
  variants: readonly VariantDefinition[];
}

/** One finding, built in one call. */
export function finding(
  rule: string,
  severity: 'fail' | 'warn',
  message: string,
  remediation: string,
  screenId?: ScreenId,
): CheckFinding {
  const entry: CheckFinding = { rule, severity, message, remediation };
  if (screenId !== undefined) return { ...entry, screenId };
  return entry;
}

/** Read and parse one JSON file, naming the file on failure. */
export function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileText(filePath)) as unknown;
  } catch (error) {
    if (error instanceof TestOrbitError) throw error;
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Could not parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the file by hand or re-learn the screen.',
      { filePath },
    );
  }
}

/** Same element-id set, ignoring order. */
function sameIdSet(left: readonly ElementId[], right: readonly ElementId[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

/** Load one screen's base elements leniently. */
function loadBaseElements(
  elementsPath: string,
  screenId: ScreenId,
  findings: CheckFinding[],
): readonly LearnedScreenElement[] {
  if (!fs.existsSync(elementsPath)) {
    findings.push(
      finding(
        'ELEMENTS_MISSING',
        'fail',
        `Screen "${screenId}" has no elements.json.`,
        'Re-learn the screen with orbit_learn_screen.',
        screenId,
      ),
    );
    return [];
  }
  try {
    return parseScreenElements(readJsonFile(elementsPath), elementsPath);
  } catch (error) {
    findings.push(
      finding(
        'ELEMENTS_INVALID',
        'fail',
        `elements.json of screen "${screenId}" is invalid: ${error instanceof Error ? error.message : String(error)}`,
        'Re-learn the screen with orbit_learn_screen, or fix the named field by hand.',
        screenId,
      ),
    );
    return [];
  }
}

/** Raw element ids of an elements.json, for the duplicate-id check. */
function rawElementIds(elementsPath: string): string[] {
  try {
    const raw = readJsonFile(elementsPath);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => (typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/** Fail on any element id listed more than once in one screen. */
function checkDuplicateElementIds(rawIds: readonly string[], screenId: ScreenId, findings: CheckFinding[]): void {
  const seen = new Set<string>();
  for (const id of rawIds) {
    if (seen.has(id)) {
      findings.push(
        finding(
          'ELEMENT_ID_DUPLICATE',
          'fail',
          `Screen "${screenId}" lists element id "${id}" more than once in elements.json: one selector per id.`,
          'Re-learn the screen so elements.json holds one entry per element id.',
          screenId,
        ),
      );
    }
    seen.add(id);
  }
}

/** Check one variant file's stamp and references against the base elements. */
function checkVariantFile(
  definition: VariantDefinition,
  baseIds: ReadonlySet<ElementId>,
  findings: CheckFinding[],
): void {
  const expected = computeVariantFingerprintStamp({
    screenId: definition.screenId,
    variantId: definition.variantId,
    required: definition.required,
    optional: definition.optional,
    excluded: definition.excluded,
  });
  if (definition.fingerprintStamp !== expected) {
    findings.push(
      finding(
        'FINGERPRINT_STAMP_MISMATCH',
        'fail',
        `Variant "${definition.variantId}" of screen "${definition.screenId}" has a fingerprintStamp that does not match its required/optional/excluded sets: the fingerprint changed without re-learning.`,
        'Re-learn the variant with orbit learn so the stamp is recomputed, or restore the variant file.',
        definition.screenId,
      ),
    );
  }
  for (const id of [...definition.required, ...definition.optional, ...definition.excluded]) {
    if (baseIds.has(id)) continue;
    findings.push(
      finding(
        'VARIANT_REFERENCES_UNKNOWN_ELEMENT',
        'fail',
        `Variant "${definition.variantId}" of screen "${definition.screenId}" references element "${id}", which has no entry in elements.json.`,
        'Re-learn the screen so elements.json holds the element, or fix the variant file.',
        definition.screenId,
      ),
    );
  }
}

/** Flag the value-change rejection and the variant-count guardrail. */
function checkVariantSets(variants: readonly VariantDefinition[], findings: CheckFinding[]): void {
  for (let i = 0; i < variants.length; i += 1) {
    for (let j = i + 1; j < variants.length; j += 1) {
      const left = variants[i] as VariantDefinition;
      const right = variants[j] as VariantDefinition;
      if (!sameIdSet(left.required, right.required)) continue;
      if (!sameIdSet(left.excluded, right.excluded)) continue;
      findings.push(
        finding(
          'VALUE_CHANGE_DUPLICATE',
          'fail',
          `Variants "${left.variantId}" and "${right.variantId}" of screen "${left.screenId}" have identical required+excluded sets: same component set, different values — not a new variant.`,
          'Keep one variant; a different price, count, or timestamp is the same variant.',
          left.screenId,
        ),
      );
    }
  }
  if (variants.length === 0) return;
  const screenId = (variants[0] as VariantDefinition).screenId;
  if (variants.length > VARIANT_FAIL_THRESHOLD) {
    findings.push(
      finding(
        'VARIANT_COUNT_EXCEEDED',
        'fail',
        `Screen "${screenId}" has ${variants.length} variants (fail threshold ${VARIANT_FAIL_THRESHOLD}).`,
        'Split the screen into two logical screens, or remove a variant that is no longer real.',
        screenId,
      ),
    );
  } else if (variants.length > VARIANT_FLAG_THRESHOLD) {
    findings.push(
      finding(
        'VARIANT_COUNT_FLAG',
        'warn',
        `Screen "${screenId}" has ${variants.length} variants (flag threshold ${VARIANT_FLAG_THRESHOLD}); consider splitting it.`,
        'Consider splitting the screen into two logical screens.',
        screenId,
      ),
    );
  }
}

/** Load one variant file leniently; a bad file becomes a finding. */
function loadVariantFile(filePath: string, findings: CheckFinding[]): VariantDefinition | null {
  try {
    return parseVariantDefinition(readJsonFile(filePath), filePath);
  } catch (error) {
    findings.push(
      finding(
        'VARIANT_FILE_INVALID',
        'fail',
        `Variant file ${filePath} is invalid: ${error instanceof Error ? error.message : String(error)}`,
        'Re-learn the variant with orbit learn, or fix the named field by hand.',
      ),
    );
    return null;
  }
}

/** Load every variant file of one screen leniently. */
function loadVariantFiles(variantsDir: string, findings: CheckFinding[]): VariantDefinition[] {
  const variants: VariantDefinition[] = [];
  for (const name of listFiles(variantsDir).filter((entry) => entry.endsWith('.json'))) {
    const definition = loadVariantFile(path.join(variantsDir, name), findings);
    if (definition !== null) variants.push(definition);
  }
  return variants;
}

/** Warn when one screen is below the 80% scope rule (never fails here). */
function warnLowScreenScope(
  screenId: ScreenId,
  elements: readonly LearnedScreenElement[],
  findings: CheckFinding[],
): void {
  const coverage = stableCoverage(elements);
  if (elements.length === 0 || coverage.pct >= SCOPE_MIN_PCT) return;
  findings.push(
    finding(
      'SCOPE_SCREEN_BELOW_80',
      'warn',
      `Screen "${screenId}" has ${coverage.pct}% stable coverage (${coverage.covered} of ${coverage.total} interactive elements carry a resourceId or unique contentDesc).`,
      'Add resourceIds or unique contentDescs to the app so the screen reaches 80%.',
      screenId,
    ),
  );
}

/**
 * Load one learned screen leniently; bad files become findings.
 *
 * @param projectRoot - Project root (absolute).
 * @param platform - Target platform.
 * @param screenId - Screen to load.
 * @param findings - Findings to append to.
 * @returns The loaded screen (empty elements/variants when files are bad).
 */
export function loadOneScreen(
  projectRoot: string,
  platform: Platform,
  screenId: ScreenId,
  findings: CheckFinding[],
): LoadedScreen {
  const screenDir = path.join(getPlatformDir(projectRoot, platform), 'screens', screenId);
  const elementsPath = path.join(screenDir, 'elements.json');
  const elements = loadBaseElements(elementsPath, screenId, findings);
  checkDuplicateElementIds(rawElementIds(elementsPath), screenId, findings);
  const variants = loadVariantFiles(path.join(screenDir, 'variants'), findings);
  const baseIds = new Set(elements.map((element) => element.id));
  for (const definition of variants) checkVariantFile(definition, baseIds, findings);
  checkVariantSets(variants, findings);
  warnLowScreenScope(screenId, elements, findings);
  return { screenId, elements, variants };
}

/**
 * Load every learned screen of one platform, leniently.
 *
 * @param projectRoot - Project root (absolute).
 * @param platform - Target platform.
 * @param findings - Findings to append to.
 * @returns Loaded screens, sorted by screen id.
 */
export function loadLearnedScreens(
  projectRoot: string,
  platform: Platform,
  findings: CheckFinding[],
): LoadedScreen[] {
  const screensDir = path.join(getPlatformDir(projectRoot, platform), 'screens');
  const loaded: LoadedScreen[] = [];
  for (const name of listSubdirectories(screensDir)) {
    let screenId: ScreenId;
    try {
      screenId = toScreenId(name);
    } catch {
      findings.push(
        finding(
          'INVALID_SCREEN_ID',
          'fail',
          `Screen folder "${name}" is not a valid screen id: must be 1-80 characters of letters, numbers, dot, underscore, or hyphen.`,
          'Rename the folder to a kebab-case screen id such as "checkout".',
        ),
      );
      continue;
    }
    loaded.push(loadOneScreen(projectRoot, platform, screenId, findings));
  }
  return loaded;
}
