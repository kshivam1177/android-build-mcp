/**
 * `orbit learn` (Phase 4 — fills the Phase 3 gap: `detect` prints
 * `orbit learn --screen … --variantId …`, so the command must exist).
 *
 * Thin wrapper around `LearnScreenUseCase`: drive the app into the
 * variant's state, dump the hierarchy, learn the variant. Output goes
 * through `process.stdout.write` (no `console.log` in TestOrbit code).
 */
import { LearnScreenUseCase } from '../../application/learn-screen.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform, toScreenId, toVariantId } from '../../domain/types.js';
import type { ElementId, Platform, ScreenId, VariantId } from '../../domain/types.js';
import { loadHierarchySource } from './hierarchy-source.js';
import type { HierarchyProvider } from '../../infrastructure/hierarchy-provider.js';
import { VariantStore } from '../../infrastructure/variant-store.js';

/** Inputs to `orbit learn`. */
export interface LearnCommandOptions {
  projectRoot: string;
  platform: Platform;
  screenId: ScreenId;
  variantId: VariantId;
  /** Designated required element ids (comma-separated on the CLI). */
  requiredIds?: readonly ElementId[];
  /** Provenance, e.g. `recording: <name>.json`. */
  learnedFrom?: string;
  /** Offline hierarchy dump file (`{ nodes, display }`). */
  hierarchyFile?: string;
  /** Live hierarchy source; required when no hierarchy file is given. */
  hierarchyProvider?: HierarchyProvider;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Run `orbit learn`.
 *
 * @param options - Project, platform, screen, variant, hierarchy source.
 * @returns 0 when the variant is learned.
 * @throws TestOrbitError when the platform is unsupported or learning rejects the variant.
 */
export async function runLearnCommand(options: LearnCommandOptions): Promise<number> {
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
  const { nodes, display } = await loadHierarchySource(options);
  const useCase = new LearnScreenUseCase(new VariantStore(options.projectRoot, options.platform));
  const result = useCase.learnVariant({
    projectRoot: options.projectRoot,
    platform: options.platform,
    screenId: options.screenId,
    variantId: options.variantId,
    nodes,
    display,
    ...(options.requiredIds !== undefined ? { requiredIds: options.requiredIds } : {}),
    ...(options.learnedFrom !== undefined ? { learnedFrom: options.learnedFrom } : {}),
  });
  write(
    `${JSON.stringify(
      {
        screenId: options.screenId,
        variantId: options.variantId,
        path: result.path,
        backupPath: result.backupPath,
        backfilledVariants: [...result.backfilledVariants],
        ...(result.warning !== undefined ? { warning: result.warning } : {}),
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

/** Brand a screen id string from CLI arguments. */
export function learnScreenIdFromCli(value: string): ScreenId {
  return toScreenId(value);
}

/** Brand a variant id string from CLI arguments. */
export function variantIdFromCli(value: string): VariantId {
  return toVariantId(value);
}
