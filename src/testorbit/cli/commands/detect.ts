/**
 * `orbit detect` (Phase 2, B7) — dump the live hierarchy, run variant
 * detection, print the variant id or `unknown` with evidence.
 *
 * The command takes either a hierarchy provider (live dump) or a
 * hierarchy dump file (`--hierarchy-file`, offline). The unknown path
 * prints the exact `orbit learn` command to learn the state as a new
 * variant; a human runs it. Output goes through `process.stdout.write`
 * (no `console.log` in TestOrbit code, Part D).
 */
import { DetectVariantUseCase, serialiseDetectionResult } from '../../application/detect-variant.js';
import type { DetectVariantInput } from '../../application/detect-variant.js';
import type { ScreenIdentificationResult, VariantDetectionResult } from '../../core/variant-match.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform, toScreenId } from '../../domain/types.js';
import type { Platform, ScreenId } from '../../domain/types.js';
import { loadHierarchySource } from './hierarchy-source.js';
import type { HierarchyProvider } from '../../infrastructure/hierarchy-provider.js';
import { VariantStore } from '../../infrastructure/variant-store.js';

/** Inputs to `orbit detect`. */
export interface DetectCommandOptions {
  projectRoot: string;
  platform: Platform;
  /** When set, detect within this screen; otherwise identify across screens. */
  screenId?: ScreenId;
  /** Offline hierarchy dump file (`{ nodes, display }`). */
  hierarchyFile?: string;
  /** Live hierarchy source; required when no hierarchy file is given. */
  hierarchyProvider?: HierarchyProvider;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Print the outcome lines for a non-match and return the exit code.
 *
 * @param result - Detection result.
 * @param options - Detect command options.
 * @param write - Output sink.
 * @returns 0 when matched, 1 otherwise.
 */
function printOutcome(
  result: VariantDetectionResult | ScreenIdentificationResult,
  options: DetectCommandOptions,
  write: (text: string) => void,
): number {
  if (result.kind === 'matched') return 0;
  if (result.kind === 'unknown' && options.screenId !== undefined) {
    write(
      `Learn it as a new variant: orbit learn --screen ${options.screenId} --variantId <variant-name> --platform ${options.platform}\n`,
    );
  }
  if (result.kind === 'unknown' && options.screenId === undefined) {
    write('Learn it as a new variant: orbit learn --screen <screen-id> --variantId <variant-name>\n');
  }
  if (result.kind === 'ambiguous') {
    write(`Ambiguous match: ${result.candidates.join(', ')} — learn the combined state with orbit learn.\n`);
  }
  return 1;
}

/**
 * Run `orbit detect`.
 *
 * @param options - Project, platform, screen, and hierarchy source.
 * @returns 0 when a variant is identified, 1 when the screen/variant is
 *   unknown or ambiguous.
 * @throws TestOrbitError when no hierarchy source is given or the platform
 *   is unsupported.
 */
export async function runDetectCommand(options: DetectCommandOptions): Promise<number> {
  if (!isPlatform(options.platform)) {
    throw new TestOrbitError(
      'INVALID_PLATFORM',
      `Unsupported platform "${options.platform}".`,
      'Pass one of android, ios, flutter, web.',
      { platform: options.platform },
    );
  }
  const write = options.write ?? ((text: string): void => {
    process.stdout.write(text);
  });
  const useCase = new DetectVariantUseCase(new VariantStore(options.projectRoot, options.platform));
  const { nodes, display } = await loadHierarchySource(options);
  const input: DetectVariantInput = {
    projectRoot: options.projectRoot,
    platform: options.platform,
    nodes,
    display,
  };
  if (options.screenId !== undefined) input.screenId = options.screenId;
  const result = useCase.detect(input);
  write(`${JSON.stringify(serialiseDetectionResult(result), null, 2)}\n`);
  return printOutcome(result, options, write);
}

/** Brand a screen id string from CLI arguments. */
export function screenIdFromCli(value: string): ScreenId {
  return toScreenId(value);
}
