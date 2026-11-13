/**
 * Recorder instrumentation (Phase 5, B8) — the shared
 * `detectScreenVariant()` helper the UI-automation tool handlers call
 * around each action.
 *
 * The recorder (`src/automation/recorder.ts`) is a passive store: it
 * cannot capture screens. The handlers are the real actor — they own
 * the backend — so each handler captures a detection snapshot before
 * the action and annotates the action after it, through this class.
 * Detection is best-effort annotation: it never throws and never fails
 * the action it annotates. An action is always recorded; when
 * identification cannot run, the action carries no screen/variant and
 * a note saying why, and when it runs but matches nothing, the action
 * carries `variantId: "unknown"` with the match evidence as its note
 * (B7 — the post-pass annotator can still fill it in by
 * selector-matching, and the converter fails loudly if it cannot).
 *
 * Navigation step (B8 scope): an action after which the matched
 * `(screen, variant)` changes, from the pre/post match comparison.
 * The recorded pair is always the pre-action screen — the screen the
 * action happened on — and `isNavigationStep` flags the change.
 */
import { matchesStableSelector } from '../core/matcher.js';
import type { ScreenIdentificationResult } from '../core/variant-match.js';
import { UnknownScreenError } from '../domain/errors.js';
import type { CoreHierarchyNode, ElementId, Platform, ScreenId, StableSelector, VariantId } from '../domain/types.js';
import { toVariantId } from '../domain/types.js';
import type { DisplaySize } from '../core/screen-identity.js';
import { serialiseDetectionResult } from './detect-variant.js';
import type { DetectVariantUseCase } from './detect-variant.js';
import type { HierarchyProvider } from '../infrastructure/hierarchy-provider.js';
import type { VariantStore } from '../infrastructure/variant-store.js';

/** Max characters kept of an unknown-detection evidence string. */
export const MAX_DETECTION_NOTE_LENGTH = 1000;

/** Variant id recorded when identification ran but matched nothing (B7). */
export const UNKNOWN_VARIANT_ID: VariantId = toVariantId('unknown');

/** One detection snapshot: the (screen, variant) of a fresh dump. */
export type RecordDetection =
  | { status: 'matched'; screenId: ScreenId; variantId: VariantId }
  | { status: 'unknown'; evidence: string }
  | { status: 'unavailable'; reason: string };

/** Annotation computed for one recorded action (pre + post detection). */
export interface ActionAnnotation {
  screenId?: ScreenId;
  variantId?: VariantId;
  elementId?: ElementId;
  /** True when the matched (screen, variant) changed across the action. */
  isNavigationStep: boolean;
  /** Evidence of an unknown screen, or why detection could not run. */
  detectionNote?: string;
}

/** Dependencies of the recorder detector (all injected, Part D, D3). */
export interface RecordingDetectorDeps {
  useCase: DetectVariantUseCase;
  provider: HierarchyProvider;
  store: VariantStore;
  projectRoot: string;
  platform: Platform;
}

/** Message of an unknown error value (never `any`, never a bare cast). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Truncate an evidence string to the recorded-note budget. */
function truncateNote(value: string): string {
  if (value.length <= MAX_DETECTION_NOTE_LENGTH) return value;
  return `${value.slice(0, MAX_DETECTION_NOTE_LENGTH)}…`;
}

/** Whether two matched detections name the same (screen, variant). */
function samePair(left: RecordDetection, right: RecordDetection): boolean {
  return (
    left.status === 'matched' &&
    right.status === 'matched' &&
    left.screenId === right.screenId &&
    left.variantId === right.variantId
  );
}

/**
 * Detects the (screen, variant) around recorded actions and resolves
 * the acted-on element against the learned screen.
 */
export class RecordingDetector {
  /**
   * @param deps - Injected use case, hierarchy provider, variant store,
   *   project root, and platform (the store's platform folder is the
   *   source of the learned screens).
   */
  constructor(private readonly deps: RecordingDetectorDeps) {}

  /**
   * Dump the live hierarchy once and identify its (screen, variant).
   * Never throws: a failed dump or an unlearned screen set is reported
   * as `unavailable`, a dump matching nothing as `unknown` with the
   * match evidence — the action is still recorded either way.
   *
   * @returns The detection snapshot for this moment.
   */
  async detectCurrent(): Promise<RecordDetection> {
    let nodes: readonly CoreHierarchyNode[];
    let display: DisplaySize;
    try {
      nodes = await this.deps.provider.dumpHierarchy();
      display = await this.deps.provider.displaySize();
    } catch (error) {
      return { status: 'unavailable', reason: `hierarchy dump failed: ${messageOf(error)}` };
    }
    let result: ScreenIdentificationResult;
    try {
      result = this.deps.useCase.identify({
        projectRoot: this.deps.projectRoot,
        platform: this.deps.platform,
        nodes,
        display,
      });
    } catch (error) {
      if (error instanceof UnknownScreenError) {
        return { status: 'unavailable', reason: error.message };
      }
      return { status: 'unavailable', reason: `screen identification failed: ${messageOf(error)}` };
    }
    if (result.kind === 'matched') {
      return { status: 'matched', screenId: result.screenId, variantId: result.variantId };
    }
    return { status: 'unknown', evidence: truncateNote(describeUnknown(result)) };
  }

  /**
   * Annotate one action from its pre-action snapshot: re-detect after
   * the action, compare the pairs for a navigation step, and resolve
   * the acted-on element against the pre-action screen.
   *
   * @param before - Pre-action detection snapshot.
   * @param selector - Stable-selector fields of the acted-on element,
   *   when the action targeted one (tap / long-press / type with an
   *   element ref); absent for key presses and bare swipes.
   * @returns The annotation to store on the recorded action.
   */
  async annotateAction(before: RecordDetection, selector?: StableSelector): Promise<ActionAnnotation> {
    const after = await this.detectCurrent();
    if (before.status === 'matched') {
      const annotation: ActionAnnotation = {
        screenId: before.screenId,
        variantId: before.variantId,
        // Navigation needs both sides matched: an unknown post-action
        // screen is not a named destination, so it is not a step.
        isNavigationStep: after.status === 'matched' && !samePair(before, after),
      };
      const elementId = this.resolveElement(before.screenId, selector);
      if (elementId !== undefined) annotation.elementId = elementId;
      return annotation;
    }
    if (before.status === 'unknown') {
      return { variantId: UNKNOWN_VARIANT_ID, isNavigationStep: false, detectionNote: before.evidence };
    }
    return { isNavigationStep: false, detectionNote: before.reason };
  }

  /**
   * Resolve an action's element id against one learned screen, by
   * stable-selector fields only (B5 — never text, never coordinates).
   * Ambiguous or unresolvable selectors yield no element id: the
   * post-pass annotator resolves (or fails loudly on) them at convert
   * time, and the action is never given a guessed element.
   *
   * @param screenId - Screen the action happened on.
   * @param selector - Stable-selector fields of the acted-on element.
   * @returns The unique matching element id, or undefined.
   */
  private resolveElement(screenId: ScreenId, selector: StableSelector | undefined): ElementId | undefined {
    if (selector === undefined) return undefined;
    const stable: StableSelector = {};
    if (selector.resourceId !== undefined) stable.resourceId = selector.resourceId;
    if (selector.contentDesc !== undefined) stable.contentDesc = selector.contentDesc;
    if (selector.className !== undefined) stable.className = selector.className;
    if (stable.resourceId === undefined && stable.contentDesc === undefined && stable.className === undefined) {
      return undefined;
    }
    let screen;
    try {
      screen = this.deps.store.loadScreen(screenId);
    } catch {
      return undefined;
    }
    if (screen === null) return undefined;
    const matches = screen.baseElements.filter((element) => matchesStableSelector(element.selector, stable));
    if (matches.length !== 1) return undefined;
    return matches[0]?.id;
  }
}

/**
 * Describe an unknown / ambiguous identification result as evidence
 * text for the recorded action's note (B7 — never silently dropped).
 *
 * @param result - Identification result that matched nothing.
 * @returns The evidence string to store on the action.
 */
function describeUnknown(result: ScreenIdentificationResult): string {
  const serialised = serialiseDetectionResult(result);
  if (serialised.kind === 'unknown') return serialised.evidence;
  if (serialised.kind === 'ambiguous') {
    return `Ambiguous match: ${serialised.candidates.join(', ')} — ${serialised.reason}`;
  }
  return 'Unknown screen.';
}
