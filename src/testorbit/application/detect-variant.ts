/**
 * Detect-variant use case (Phase 2, B7) — the application seam between
 * the variant store, the pure matcher, and the CLI / MCP tool.
 *
 * Within a screen it detects the variant; across screens it identifies
 * the (screen, variant) from scratch. Unknown screens and variants
 * surface as typed errors with the learn command as remediation; the
 * serialised result (validated by `DetectionResultSchema`) carries the
 * match evidence for the CLI and the tool to print.
 */
import { describeFingerprintDiff } from '../core/fingerprint.js';
import type { FingerprintMatchResult } from '../core/fingerprint.js';
import { detectVariant, identifyScreen } from '../core/variant-match.js';
import type { ScreenIdentificationResult, VariantDetectionResult } from '../core/variant-match.js';
import type { DisplaySize } from '../core/screen-identity.js';
import { UnknownScreenError } from '../domain/errors.js';
import { parseDetectionResult } from '../domain/schemas.js';
import type { CoreHierarchyNode, Platform, ScreenId } from '../domain/types.js';
import type { VariantStore } from '../infrastructure/variant-store.js';

/** Inputs to one detection run. */
export interface DetectVariantInput {
  projectRoot: string;
  platform: Platform;
  /** When set, detect within this screen; otherwise identify across screens. */
  screenId?: ScreenId;
  /** Fresh hierarchy dump. */
  nodes: readonly CoreHierarchyNode[];
  display: DisplaySize;
}

/** Serialise one fingerprint result for CLI/tool output. */
function serialiseFingerprint(result: FingerprintMatchResult): {
  matched: boolean;
  missingRequired: string[];
  missingNonRequired: string[];
  added: { ref: string; selector: { resourceId?: string; contentDesc?: string; className?: string } }[];
  changedRequired: { id: string; field: 'clickable' | 'enabled'; learned: boolean; fresh: boolean }[];
  changedNonRequired: { id: string; field: 'clickable' | 'enabled'; learned: boolean; fresh: boolean }[];
  excludedPresent: string[];
  warnings: string[];
  budget: { nonRequiredCount: number; allowedDrift: number; usedDrift: number };
} {
  return {
    matched: result.matched,
    missingRequired: [...result.missingRequired],
    missingNonRequired: [...result.missingNonRequired],
    added: result.added.map((item) => ({ ref: item.ref, selector: item.selector })),
    changedRequired: [...result.changedRequired],
    changedNonRequired: [...result.changedNonRequired],
    excludedPresent: [...result.excludedPresent],
    warnings: [...result.warnings],
    budget: result.budget,
  };
}

/** Serialise a detection result (schema-validated) for output. */
export function serialiseDetectionResult(
  result: VariantDetectionResult | ScreenIdentificationResult,
): ReturnType<typeof parseDetectionResult> {
  if (result.kind === 'matched') {
    return parseDetectionResult({
      kind: 'matched',
      screenId: result.screenId,
      variantId: result.variantId,
      evidence: serialiseFingerprint(result.evidence),
    });
  }
  if (result.kind === 'unknown') {
    const evidence = result.evidence
      .map((match) => `${match.candidate.screenId}.${match.candidate.variantId}:\n${describeFingerprintDiff(match.fingerprint)}`)
      .join('\n');
    return parseDetectionResult({
      kind: 'unknown',
      screenId: 'screenId' in result && result.screenId !== null ? result.screenId : null,
      checked: [...result.checked],
      evidence,
    });
  }
  return parseDetectionResult({
    kind: 'ambiguous',
    screenId: 'screenId' in result ? result.screenId : null,
    candidates: [...result.candidates],
    reason: result.reason,
  });
}

/** Detect and identify variants against the learned screens. */
export class DetectVariantUseCase {
  /**
   * @param store - Variant store for the target platform folder.
   */
  constructor(private readonly store: VariantStore) {}

  /**
   * Detect the variant of one known screen.
   *
   * @param input - Screen, platform, fresh dump, display.
   * @returns The detection result (matched / unknown / ambiguous).
   * @throws UnknownScreenError when the screen has no learned variants.
   */
  detectForScreen(input: DetectVariantInput & { screenId: ScreenId }): VariantDetectionResult {
    const screen = this.store.loadScreen(input.screenId);
    if (screen === null || screen.variants.length === 0) {
      throw new UnknownScreenError(
        `Screen "${input.screenId}" has no learned variants on platform "${input.platform}".`,
        `Learn it first: orbit learn --screen ${input.screenId} --variantId <name> --platform ${input.platform}`,
        { screenId: input.screenId, platform: input.platform },
      );
    }
    return detectVariant(this.store.buildCandidates(screen), input.nodes, input.display);
  }

  /**
   * Identify the (screen, variant) of a fresh dump from scratch.
   *
   * @param input - Platform, fresh dump, display.
   * @returns The identification result (matched / unknown / ambiguous).
   * @throws UnknownScreenError when no screens are learned at all.
   */
  identify(input: DetectVariantInput): ScreenIdentificationResult {
    const candidates = this.store.buildAllCandidates();
    if (candidates.length === 0) {
      throw new UnknownScreenError(
        `No screens are learned on platform "${input.platform}" yet.`,
        'Learn a screen first: orbit learn --screen <id> --variantId <name>',
        { platform: input.platform },
      );
    }
    return identifyScreen(candidates, input.nodes, input.display);
  }

  /**
   * Detect within a screen when one is given, otherwise identify.
   *
   * @param input - Detection inputs.
   * @returns The detection or identification result.
   */
  detect(input: DetectVariantInput): VariantDetectionResult | ScreenIdentificationResult {
    if (input.screenId !== undefined) {
      return this.detectForScreen({ ...input, screenId: input.screenId });
    }
    return this.identify(input);
  }
}
