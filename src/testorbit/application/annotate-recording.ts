/**
 * Post-pass annotator (Part B, B7) — fills `variantId: "unknown"`
 * actions by selector-matching, not by re-running identification.
 *
 * A recording carries no fresh hierarchy, so the annotator cannot
 * re-run identification; this selector-matching is weaker and the plan
 * says so. For each action it resolves the stable-selector fields
 * (resourceId/contentDesc/className, never text) against the learned
 * `(screen, variant)` definitions: on a unique match it fills in the
 * screen+variant (and the element id, via the convert-time resolution
 * in C2), on no match or an ambiguous match the converter fails loudly
 * naming the action.
 *
 * Host-agent grounding (D7): when the hierarchy and Tesseract both
 * fail, the host agent grounds the element by LLM vision and supplies
 * it as a `GroundedElementOverride`; the override wins over selector
 * resolution and the step records `groundedBy: "llm-vision"`.
 */
import { matchesStableSelector } from '../core/matcher.js';
import { ConversionError } from '../domain/errors.js';
import type { TestOrbitRecordedAction, TestOrbitRecordingDocument } from '../domain/recording-schemas.js';
import type { ElementId, ScreenId, StableSelector, VariantId } from '../domain/types.js';
import { toElementId, toScreenId, toVariantId } from '../domain/types.js';
import type { ScreenData } from '../infrastructure/variant-store.js';

/** A host-agent-supplied grounded element for one action (D7 fallback). */
export interface GroundedElementOverride {
  actionId: string;
  elementId: ElementId;
  screenId?: ScreenId;
  variantId?: VariantId;
  method: 'llm-vision';
  detail?: string;
}

/** One action with its screen, variant, and element resolved. */
export interface AnnotatedAction {
  action: TestOrbitRecordedAction;
  screenId: ScreenId;
  variantId: VariantId;
  /** Null for actions with no element (key press, bare swipe). */
  elementId: ElementId | null;
  groundedBy?: 'hierarchy' | 'tesseract' | 'llm-vision';
}

/** Stable-selector fields of a recorded action (text stripped, B5). */
function stableFields(action: TestOrbitRecordedAction): StableSelector {
  const selector: StableSelector = {};
  if (action.selector?.resourceId !== undefined) selector.resourceId = action.selector.resourceId;
  if (action.selector?.contentDesc !== undefined) selector.contentDesc = action.selector.contentDesc;
  if (action.selector?.className !== undefined) selector.className = action.selector.className;
  return selector;
}

/** Whether a recorded selector carries any stable field at all. */
function hasStableFields(selector: StableSelector): boolean {
  return selector.resourceId !== undefined || selector.contentDesc !== undefined || selector.className !== undefined;
}

/** Screen id from an element id's prefix (`login.submit` → `login`). */
function screenOfElement(elementId: ElementId): ScreenId {
  const prefix = elementId.split('.')[0] as string;
  return toScreenId(prefix);
}

/** Variants of one screen whose required/optional sets contain an element. */
function variantsContaining(screen: ScreenData, elementId: ElementId): readonly VariantId[] {
  return screen.variants
    .filter((variant) => variant.required.includes(elementId) || variant.optional.includes(elementId))
    .map((variant) => variant.variantId);
}

/**
 * Resolve one action's element id against one learned screen.
 *
 * @param screen - Learned screen to match against.
 * @param selector - Stable-selector fields (never text).
 * @param actionId - Action id, named on failure.
 * @returns The unique matching element id.
 * @throws ConversionError on no match or an ambiguous match.
 */
function resolveElementOnScreen(
  screen: ScreenData,
  selector: StableSelector,
  actionId: string,
): ElementId {
  const matches = screen.baseElements.filter((element) => matchesStableSelector(element.selector, selector));
  if (matches.length === 1) {
    const match = matches[0];
    if (match !== undefined) return match.id;
  }
  if (matches.length === 0) {
    throw new ConversionError(
      `Action "${actionId}" cannot be converted: no element on screen "${screen.screenId}" matches its selector.`,
      'Learn the element on that screen first, or supply it with a grounding override.',
      { actionId, screenId: screen.screenId },
    );
  }
  throw new ConversionError(
    `Action "${actionId}" cannot be converted: its selector matches ${matches.length} elements on screen "${screen.screenId}" (${matches.map((element) => element.id).join(', ')}).`,
    'Learn the elements with distinguishing selectors, or supply the element with a grounding override.',
    { actionId, screenId: screen.screenId },
  );
}

/**
 * Find the variant for an element on its screen: the unique variant
 * claiming it, else `default` when no variant claims it.
 *
 * @param screen - Learned screen.
 * @param elementId - Resolved element id.
 * @param actionId - Action id, named on failure.
 * @returns The variant id.
 * @throws ConversionError when several variants claim the element.
 */
function variantForElement(screen: ScreenData, elementId: ElementId, actionId: string): VariantId {
  const claiming = variantsContaining(screen, elementId);
  if (claiming.length === 1) return claiming[0] as VariantId;
  if (claiming.length === 0) return toVariantId('default');
  throw new ConversionError(
    `Action "${actionId}" cannot be annotated: element "${elementId}" is claimed by ${claiming.length} variants of screen "${screen.screenId}" (${claiming.join(', ')}).`,
    'Record the flow with screen+variant annotations, or learn the variants apart.',
    { actionId, elementId, screenId: screen.screenId },
  );
}

/** All (screen, element) pairs matching a stable selector across screens. */
function findSelectorHits(
  screens: readonly ScreenData[],
  selector: StableSelector,
): { screen: ScreenData; elementId: ElementId }[] {
  const hits: { screen: ScreenData; elementId: ElementId }[] = [];
  for (const screen of screens) {
    const matches = screen.baseElements.filter((element) => matchesStableSelector(element.selector, selector));
    for (const element of matches) hits.push({ screen, elementId: element.id });
  }
  return hits;
}

/**
 * Annotate one action that carries no screen/variant of its own.
 *
 * @param action - Recorded action (v1, or v2 with `unknown` ids).
 * @param screens - Learned screens of the platform.
 * @param previous - Previously annotated action (screen fallback for key/swipe).
 * @returns The annotated action.
 * @throws ConversionError naming the action on no/ambiguous match.
 */
function annotateUnresolved(
  action: TestOrbitRecordedAction,
  screens: readonly ScreenData[],
  previous: AnnotatedAction | undefined,
): AnnotatedAction {
  if (action.type === 'key_press' || (action.selector === undefined && action.type === 'swipe')) {
    if (previous === undefined) {
      throw new ConversionError(
        `Action "${action.id}" (${action.type}) is the first action and carries no screen: it cannot be annotated.`,
        'Start the recording with an action that has a selector, so the screen can be identified.',
        { actionId: action.id },
      );
    }
    return { action, screenId: previous.screenId, variantId: previous.variantId, elementId: null };
  }
  const selector = stableFields(action);
  if (!hasStableFields(selector)) {
    throw new ConversionError(
      `Action "${action.id}" cannot be converted: it has no stable selector (no resourceId, contentDesc, or className).`,
      'Re-record the action against a learned element, or supply it with a grounding override.',
      { actionId: action.id },
    );
  }
  const hits = findSelectorHits(screens, selector);
  if (hits.length !== 1) {
    throw new ConversionError(
      `Action "${action.id}" cannot be annotated: its selector matches ${hits.length} elements across the learned screens.`,
      'Learn the element with a distinguishing selector, or supply it with a grounding override.',
      { actionId: action.id },
    );
  }
  const hit = hits[0];
  if (hit === undefined) {
    throw new ConversionError(
      `Action "${action.id}" cannot be annotated: its selector matched, but the match was lost.`,
      'Re-run orbit convert; this is a TestOrbit bug if it repeats.',
      { actionId: action.id },
    );
  }
  return {
    action,
    screenId: hit.screen.screenId,
    variantId: variantForElement(hit.screen, hit.elementId, action.id),
    elementId: hit.elementId,
    ...(action.grounding !== undefined ? { groundedBy: action.grounding.method } : {}),
  };
}

/**
 * Annotate one action from a host-agent grounding override (D7).
 *
 * @param action - Recorded action.
 * @param override - The host agent's grounded element for this action.
 * @param screens - Learned screens of the platform.
 * @returns The annotated action, marked `groundedBy: "llm-vision"`.
 * @throws ConversionError when the override's screen or variant is unknown.
 */
function annotateOverride(
  action: TestOrbitRecordedAction,
  override: GroundedElementOverride,
  screens: readonly ScreenData[],
): AnnotatedAction {
  const screenId = override.screenId ?? screenOfElement(override.elementId);
  const screen = screens.find((candidate) => candidate.screenId === screenId);
  if (screen === undefined) {
    throw new ConversionError(
      `Grounding override for action "${action.id}" names unknown screen "${screenId}".`,
      'Learn the screen first, or fix the override.',
      { actionId: action.id, screenId },
    );
  }
  const variantId = override.variantId ?? variantForElement(screen, override.elementId, action.id);
  return { action, screenId, variantId, elementId: override.elementId, groundedBy: 'llm-vision' };
}

/**
 * Annotate every action of a recording (B7 post-pass annotator).
 *
 * @param recording - Parsed recording (v1 or v2).
 * @param screens - Learned screens of the platform.
 * @param overrides - Host-agent grounding overrides, by action id.
 * @returns The actions in order, each with screen, variant, and element.
 * @throws ConversionError naming the first action that cannot be resolved.
 */
export function annotateRecording(
  recording: TestOrbitRecordingDocument,
  screens: readonly ScreenData[],
  overrides: readonly GroundedElementOverride[] = [],
): AnnotatedAction[] {
  if (screens.length === 0) {
    throw new ConversionError(
      'Cannot convert a recording with no learned screens on this platform.',
      'Learn the flow screens first with orbit learn.',
      {},
    );
  }
  const byActionId = new Map(overrides.map((override) => [override.actionId, override]));
  const annotated: AnnotatedAction[] = [];
  for (const action of recording.actions) {
    const override = byActionId.get(action.id);
    if (override !== undefined) {
      annotated.push(annotateOverride(action, override, screens));
      continue;
    }
    if (action.screenId !== undefined && action.variantId !== undefined) {
      const screenId = toScreenId(action.screenId);
      const screen = screens.find((candidate) => candidate.screenId === screenId);
      if (screen === undefined) {
        throw new ConversionError(
          `Action "${action.id}" names unknown screen "${action.screenId}".`,
          'Learn the screen first with orbit learn.',
          { actionId: action.id, screenId: action.screenId },
        );
      }
      const elementId =
        action.elementId !== undefined
          ? toElementId(action.elementId)
          : resolveElementOnScreen(screen, stableFields(action), action.id);
      annotated.push({
        action,
        screenId,
        variantId: toVariantId(action.variantId),
        elementId,
        ...(action.grounding !== undefined ? { groundedBy: action.grounding.method } : {}),
      });
      continue;
    }
    annotated.push(annotateUnresolved(action, screens, annotated[annotated.length - 1]));
  }
  return annotated;
}
