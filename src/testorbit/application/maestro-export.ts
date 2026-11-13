/**
 * Maestro export (Phase 4, C2) — turns a canonical test case into a
 * validated Maestro flow.
 *
 * Selector rule: a learned element's `resourceId` maps to Maestro
 * `{ id }` first; `contentDesc` maps to `{ text }` second (Maestro
 * text matching covers accessibility labels); a className-only element
 * cannot be mapped and fails the conversion loudly naming the element
 * — never a guessed selector, never a coordinate tap.
 *
 * Assertion mapping (C2 assert-payload shapes): `variant-present` →
 * `assertVisible` per the emission rule (unique required element, else
 * all required elements); `visible` → `assertVisible: { text | id }`;
 * `contains` → `assertVisible: { text: "<substring>" }`;
 * `not_visible` → `assertNotVisible: { text | id }`;
 * `not_contains` → `assertNotVisible: { text: "<substring>" }`.
 *
 * The loading pair is emitted here by the converter's caller: before a
 * navigation-dependent step, `assertNotVisible` on the indicator plus
 * `assertVisible` on the step's target resourceId. There is no
 * repo-side element-state assertion in v1 (B6/C2).
 */
import { assertionElementIds } from '../core/assertions.js';
import { ConversionError } from '../domain/errors.js';
import { parseMaestroFlow, renderMaestroYaml } from '../domain/maestro-schema.js';
import type { MaestroCommand, MaestroFlow, MaestroSelector } from '../domain/maestro-schema.js';
import type { TestCase, TestCaseStep } from '../domain/testcase-schemas.js';
import type { ElementId, LearnedScreenElement, StableSelector } from '../domain/types.js';
import { toElementId } from '../domain/types.js';
import type { ScreenData } from '../infrastructure/variant-store.js';

/** Resolves an element id to its learned stable selector. */
export type SelectorResolver = (elementId: ElementId) => StableSelector;

/** A loading indicator, keyed by screen id (converter input). */
export interface LoadingIndicator {
  elementId?: ElementId;
  text?: string;
}

/** Options for building a Maestro flow from a test case. */
export interface MaestroExportOptions {
  /** Maestro app id for the flow header. */
  appId: string;
  /** Loading indicators per screen id (navigation steps only). */
  loadingIndicators?: Readonly<Record<string, LoadingIndicator>>;
}

/**
 * Build an element-id → selector map from loaded screens.
 *
 * @param screens - Loaded screens (base elements only).
 * @returns A map from element id to stable selector.
 */
export function elementSelectorMap(
  screens: readonly ScreenData[],
): ReadonlyMap<ElementId, StableSelector> {
  const map = new Map<ElementId, StableSelector>();
  for (const screen of screens) {
    for (const element of screen.baseElements) map.set(element.id, element.selector);
  }
  return map;
}

/**
 * Map one learned element's stable selector to a Maestro selector.
 *
 * @param selector - Learned stable selector.
 * @param elementId - Element id, named when the selector cannot map.
 * @returns The Maestro selector (`{ id }` first, `{ text }` second).
 * @throws ConversionError when the element has no resourceId or contentDesc.
 */
export function maestroSelectorFor(selector: StableSelector, elementId: ElementId): MaestroSelector {
  if (selector.resourceId !== undefined) return { id: selector.resourceId };
  if (selector.contentDesc !== undefined) return { text: selector.contentDesc };
  throw new ConversionError(
    `Element "${elementId}" has no resourceId or contentDesc, so it cannot be mapped to a Maestro selector.`,
    'Re-learn the screen so the element carries a resourceId or a unique contentDesc.',
    { elementId },
  );
}

/**
 * The `assertVisible` commands for one variant (the emission rule).
 *
 * @param screens - Loaded screens.
 * @param screenId - Screen of the variant.
 * @param variantId - Variant to assert present.
 * @returns One `assertVisible` per assertion element.
 * @throws ConversionError when the screen or variant is not learned.
 */
export function variantAssertionCommands(
  screens: readonly ScreenData[],
  screenId: string,
  variantId: string,
): MaestroCommand[] {
  const screen = screens.find((candidate) => candidate.screenId === screenId);
  if (screen === undefined) {
    throw new ConversionError(
      `Cannot assert variant "${variantId}": screen "${screenId}" is not learned.`,
      'Learn the screen first with orbit learn.',
      { screenId, variantId },
    );
  }
  const definition = screen.variants.find((variant) => variant.variantId === variantId);
  if (definition === undefined) {
    throw new ConversionError(
      `Cannot assert variant "${variantId}": screen "${screenId}" has no such variant.`,
      'Learn the variant first with orbit learn.',
      { screenId, variantId },
    );
  }
  const siblings = screen.variants
    .filter((variant) => variant.variantId !== variantId)
    .map((variant) => variant.required);
  const byId = new Map(screen.baseElements.map((element) => [element.id, element]));
  return assertionElementIds(definition.required, siblings).map((id) => {
    const element: LearnedScreenElement | undefined = byId.get(id);
    if (element === undefined) {
      throw new ConversionError(
        `Variant "${variantId}" requires element "${id}", which has no entry in elements.json.`,
        'Re-learn the screen so elements.json holds the element.',
        { screenId, variantId, elementId: id },
      );
    }
    return { assertVisible: maestroSelectorFor(element.selector, id) };
  });
}

/** Resolve one step's element id to a Maestro selector. */
function selectorForStep(
  step: TestCaseStep,
  resolveSelector: SelectorResolver,
): MaestroSelector {
  if (step.elementId === undefined) {
    throw new ConversionError(
      `Step ${step.index} (${step.action}) has no elementId, so it cannot be mapped to a Maestro command.`,
      'Re-record the flow, or supply the element with a grounding override.',
      { step: String(step.index) },
    );
  }
  return maestroSelectorFor(resolveSelector(toElementId(step.elementId)), toElementId(step.elementId));
}

/** The Maestro action command for one canonical step. */
function actionCommand(step: TestCaseStep, resolveSelector: SelectorResolver): MaestroCommand {
  switch (step.action) {
    case 'tap':
      return { tapOn: selectorForStep(step, resolveSelector) };
    case 'type':
      return { inputText: step.text ?? '' };
    case 'long_press':
      return { longPressOn: selectorForStep(step, resolveSelector) };
    case 'swipe':
      return {
        swipe: {
          direction: step.direction ?? 'UP',
          ...(step.durationMs !== undefined ? { duration: step.durationMs } : {}),
        },
      };
    case 'key':
      return { pressKey: step.keyCode ?? 'BACK' };
  }
}

/** Screen of a variant id: its `<screen>.` prefix, or the step's screen for `default`. */
function screenOfVariant(variant: string, fallback: string): string {
  if (!variant.includes('.')) return fallback;
  return variant.split('.')[0] as string;
}

/** The Maestro assertion commands for one canonical step's `assert`. */
function assertCommands(
  step: TestCaseStep,
  screens: readonly ScreenData[],
): MaestroCommand[] {
  switch (step.assert.kind) {
    case 'variant-present':
      return variantAssertionCommands(
        screens,
        screenOfVariant(step.assert.variant, step.screen),
        step.assert.variant,
      );
    case 'visible':
      return [{ assertVisible: step.assert.target }];
    case 'contains':
      return [{ assertVisible: { text: step.assert.text } }];
    case 'not_visible':
      return [{ assertNotVisible: step.assert.target }];
    case 'not_contains':
      return [{ assertNotVisible: { text: step.assert.text } }];
  }
}

/** Whether a step starts a new (screen, variant) — a navigation step. */
function isNavigationStep(step: TestCaseStep, previous: TestCaseStep | undefined): boolean {
  return previous !== undefined && (step.screen !== previous.screen || step.variant !== previous.variant);
}

/** The loading pair for a navigation step, when an indicator is known. */
function loadingCommands(
  step: TestCaseStep,
  options: MaestroExportOptions,
  resolveSelector: SelectorResolver,
): MaestroCommand[] {
  const indicator = options.loadingIndicators?.[step.screen];
  if (indicator === undefined) return [];
  const target = selectorForStep(step, resolveSelector);
  if (indicator.elementId !== undefined) {
    const selector = resolveSelector(indicator.elementId);
    const notVisible: MaestroSelector = maestroSelectorFor(selector, indicator.elementId);
    return [{ assertNotVisible: notVisible }, { assertVisible: target }];
  }
  if (indicator.text !== undefined) {
    return [{ assertNotVisible: { text: indicator.text } }, { assertVisible: target }];
  }
  throw new ConversionError(
    `Loading indicator for step ${step.index} (screen "${step.screen}") has no stable text or element id.`,
    'Give the indicator a stable text or a learned element id, or drop it from the loading indicators.',
    { step: String(step.index), screenId: step.screen },
  );
}

/**
 * Build the ordered Maestro commands for a canonical test case.
 *
 * @param testCase - Validated canonical test case.
 * @param screens - Loaded screens (selectors + variant definitions).
 * @param resolveSelector - Element-id → stable-selector lookup.
 * @param options - App id and loading indicators.
 * @returns The ordered commands (setup first, teardown in `onFlowComplete`).
 */
export function buildMaestroCommands(
  testCase: TestCase,
  screens: readonly ScreenData[],
  resolveSelector: SelectorResolver,
  options: MaestroExportOptions,
): MaestroCommand[] {
  const commands: MaestroCommand[] = [];
  if (testCase.setup.launchApp) {
    commands.push({
      launchApp: { ...(testCase.setup.clearAppData ? { clearState: true } : {}), appId: options.appId },
    });
  }
  let previous: TestCaseStep | undefined;
  for (const step of testCase.steps) {
    if (isNavigationStep(step, previous)) commands.push(...loadingCommands(step, options, resolveSelector));
    commands.push(actionCommand(step, resolveSelector));
    commands.push(...assertCommands(step, screens));
    previous = step;
  }
  return commands;
}

/**
 * Build and validate the Maestro flow for a canonical test case.
 *
 * @param testCase - Validated canonical test case.
 * @param screens - Loaded screens (selectors + variant definitions).
 * @param resolveSelector - Element-id → stable-selector lookup.
 * @param options - App id and loading indicators.
 * @returns The validated flow (teardown as `onFlowComplete`).
 */
export function buildMaestroFlow(
  testCase: TestCase,
  screens: readonly ScreenData[],
  resolveSelector: SelectorResolver,
  options: MaestroExportOptions,
): MaestroFlow {
  const commands = buildMaestroCommands(testCase, screens, resolveSelector, options);
  const config: { appId: string; name: string; onFlowComplete?: { clearState: null }[] } = {
    appId: options.appId,
    name: testCase.id,
  };
  if (testCase.teardown.clearAppData) config.onFlowComplete = [{ clearState: null }];
  return parseMaestroFlow(config, commands);
}

/**
 * Render a validated flow as YAML text with the TestOrbit header.
 *
 * @param flow - Validated flow.
 * @param header - Source JSON hash, generation time, schema version.
 * @returns The YAML text.
 */
export function renderFlowYaml(
  flow: MaestroFlow,
  header: { sourceHash: string; generatedAt: string; schemaVersion: 2 },
): string {
  return renderMaestroYaml(flow, header);
}
