/**
 * Variant store (Phase 2) — reads learned screens and their variant
 * files from the platform folder.
 *
 * Layout: `<projectRoot>/.testorbit/<platform>/screens/
 * <screenId>/elements.json` holds the base elements (one selector per
 * element id) and `variants/<variantId>.json` holds each variant file
 * (B2). Variant files reference element ids; they never redefine
 * selectors — so a referenced id with no base element fails loudly here.
 *
 * Candidate construction (the shared rule, same as the test fixtures):
 * a variant's learned set is the screen's shared elements (in no
 * specific variant's required/optional sets) plus its own
 * required/optional elements; another variant's elements are never in
 * its learned set — they are in its excluded set instead. The
 * `default` variant's designated required elements are shared screen
 * elements, not owned by any variant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TestOrbitError } from '../domain/errors.js';
import { parseScreenElements, parseVariantDefinition } from '../domain/schemas.js';
import { DEFAULT_VARIANT_ID } from '../core/variant-match.js';
import type { VariantCandidate } from '../core/variant-match.js';
import { toScreenId } from '../domain/types.js';
import type { LearnedScreenElement, Platform, ScreenId, VariantDefinition } from '../domain/types.js';
import { getPlatformDir, listFiles, listSubdirectories, readFileText } from './filesystem.js';

/** One learned screen: its base elements plus its variant files. */
export interface ScreenData {
  screenId: ScreenId;
  baseElements: readonly LearnedScreenElement[];
  variants: readonly VariantDefinition[];
}

/** Read one JSON file and parse it, naming the file on failure. */
function readJsonFile(filePath: string): unknown {
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

/** Build one match candidate from a variant definition and base elements. */
function buildCandidate(
  screen: ScreenData,
  definition: VariantDefinition,
  ownedBySpecific: ReadonlySet<string>,
): VariantCandidate {
  const byId = new Map(screen.baseElements.map((element) => [element.id, element]));
  for (const id of [...definition.required, ...definition.optional, ...definition.excluded]) {
    if (!byId.has(id)) {
      throw new TestOrbitError(
        'ELEMENT_NOT_FOUND',
        `Variant "${definition.variantId}" of screen "${definition.screenId}" references element "${id}", which has no entry in elements.json.`,
        'Re-learn the screen so elements.json holds the element, or fix the variant file.',
        { screenId: definition.screenId, variantId: definition.variantId, elementId: id },
      );
    }
  }
  const excludedSet = new Set(definition.excluded);
  const own = new Set([...definition.required, ...definition.optional]);
  const elements = screen.baseElements.filter(
    (element) => !excludedSet.has(element.id) && (!ownedBySpecific.has(element.id) || own.has(element.id)),
  );
  return {
    screenId: screen.screenId,
    variantId: definition.variantId,
    required: definition.required,
    optional: definition.optional,
    excluded: definition.excluded,
    elements,
    excludedElements: screen.baseElements.filter((element) => excludedSet.has(element.id)),
  };
}

/** Read learned screens and variants from one platform folder. */
export class VariantStore {
  /**
   * @param projectRoot - Project root (absolute).
   * @param platform - Target platform.
   */
  constructor(
    private readonly projectRoot: string,
    private readonly platform: Platform,
  ) {}

  /** Absolute path of one screen's folder. */
  screenDir(screenId: ScreenId): string {
    return path.join(getPlatformDir(this.projectRoot, this.platform), 'screens', screenId);
  }

  /**
   * List the screens learned for this platform.
   *
   * @returns Screen ids with a folder under `screens/`, sorted.
   */
  listScreens(): ScreenId[] {
    const screensDir = path.join(getPlatformDir(this.projectRoot, this.platform), 'screens');
    return listSubdirectories(screensDir).map(toScreenId);
  }

  /**
   * Load one learned screen: its base elements plus its variant files.
   *
   * @param screenId - Screen to load.
   * @returns The screen data, or null when the screen has no folder.
   * @throws TestOrbitError when `elements.json` is missing or unparseable.
   */
  loadScreen(screenId: ScreenId): ScreenData | null {
    const dir = this.screenDir(screenId);
    if (!fs.existsSync(dir)) return null;
    const elementsPath = path.join(dir, 'elements.json');
    if (!fs.existsSync(elementsPath)) {
      throw new TestOrbitError(
        'ELEMENTS_MISSING',
        `Screen "${screenId}" has no elements.json in ${dir}.`,
        'Re-learn the screen with orbit_learn_screen.',
        { screenId, path: elementsPath },
      );
    }
    const baseElements = parseScreenElements(readJsonFile(elementsPath), elementsPath);
    const variantsDir = path.join(dir, 'variants');
    const variants = listFiles(variantsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const filePath = path.join(variantsDir, name);
        return parseVariantDefinition(readJsonFile(filePath), filePath);
      });
    return { screenId, baseElements, variants };
  }

  /**
   * Load every learned screen for this platform.
   *
   * @returns Screen data for each learned screen.
   */
  loadAllScreens(): ScreenData[] {
    const screens: ScreenData[] = [];
    for (const screenId of this.listScreens()) {
      const screen = this.loadScreen(screenId);
      if (screen !== null) screens.push(screen);
    }
    return screens;
  }

  /**
   * Build match candidates for one learned screen.
   *
   * @param screen - Loaded screen data.
   * @returns One candidate per variant file.
   */
  buildCandidates(screen: ScreenData): VariantCandidate[] {
    const ownedBySpecific = new Set<string>();
    for (const definition of screen.variants) {
      if (definition.variantId === DEFAULT_VARIANT_ID) continue;
      for (const id of [...definition.required, ...definition.optional]) ownedBySpecific.add(id);
    }
    return screen.variants.map((definition) => buildCandidate(screen, definition, ownedBySpecific));
  }

  /**
   * Build match candidates for every learned screen of this platform.
   *
   * @returns Candidates across all screens, for `identifyScreen`.
   */
  buildAllCandidates(): VariantCandidate[] {
    return this.loadAllScreens().flatMap((screen) => this.buildCandidates(screen));
  }
}
