/**
 * Post-run failure analysis (Part A duty 3) — dumps the current
 * hierarchy after a failed Maestro run, computes the element diff
 * against the expected `(screen, variant)`, and returns the bundle
 * inputs. The hierarchy loader and dump saver live here too: the
 * pre-flow check (in `run-test.ts`) shares them.
 */
import path from 'node:path';
import { describeFingerprintDiff } from '../core/fingerprint.js';
import type { DisplaySize } from '../core/screen-identity.js';
import { RunnerError } from '../domain/errors.js';
import type { CoreHierarchyNode, Platform } from '../domain/types.js';
import { toScreenId } from '../domain/types.js';
import { DetectVariantUseCase } from './detect-variant.js';
import { dumpNodesToCore, readHierarchyDumpFile } from '../infrastructure/hierarchy-provider.js';
import type { HierarchyProvider } from '../infrastructure/hierarchy-provider.js';
import { writeFileAtomic } from '../infrastructure/filesystem.js';
import type { VariantStore } from '../infrastructure/variant-store.js';

/** What a hierarchy load needs: project, platform, and one source. */
export interface HierarchySource {
  projectRoot: string;
  platform: Platform;
  /** Live hierarchy source; required when no hierarchy file is given. */
  hierarchyProvider?: HierarchyProvider;
  /** Offline hierarchy dump file (`{ nodes, display }`). */
  hierarchyFile?: string;
}

/** Outcome of post-run failure analysis. */
export interface PostRunAnalysis {
  hierarchyPath: string;
  diffSummary: string;
  actualScreen: string | null;
  actualVariant: string | null;
  checkedVariants: readonly string[];
}

/**
 * Load the fresh hierarchy: from a dump file or a live provider.
 *
 * @param source - Project, platform, and hierarchy source.
 * @returns The dump nodes and display size.
 * @throws RunnerError when no hierarchy source is given.
 */
export async function loadHierarchy(
  source: HierarchySource,
): Promise<{ nodes: readonly CoreHierarchyNode[]; display: DisplaySize }> {
  if (source.hierarchyFile !== undefined) {
    const dump = readHierarchyDumpFile(source.hierarchyFile);
    return { nodes: dumpNodesToCore(dump), display: dump.display };
  }
  if (source.hierarchyProvider !== undefined) {
    return {
      nodes: await source.hierarchyProvider.dumpHierarchy(),
      display: await source.hierarchyProvider.displaySize(),
    };
  }
  throw new RunnerError(
    'Pre-flow detection needs a hierarchy source: pass --hierarchy-file or run against a live device.',
    'Run orbit run with a connected device, or pass --hierarchy-file <path> with a { nodes, display } dump.',
    {},
  );
}

/**
 * Save one hierarchy dump into a run directory.
 *
 * @param dir - Run directory.
 * @param name - Dump name (`pre-flow` or `post-run`).
 * @param nodes - Dump nodes.
 * @param display - Display size.
 * @returns The absolute dump path.
 */
export function saveDump(
  dir: string,
  name: string,
  nodes: readonly CoreHierarchyNode[],
  display: DisplaySize,
): string {
  const dumpPath = path.join(dir, `${name}-hierarchy.json`);
  writeFileAtomic(dumpPath, `${JSON.stringify({ nodes, display }, null, 2)}\n`);
  return dumpPath;
}

/** Summarise one detection result as post-run analysis inputs. */
function summariseDetection(
  detection: ReturnType<DetectVariantUseCase['detectForScreen']>,
  expectedStep: { screen: string; variant: string },
  hierarchyPath: string,
): PostRunAnalysis {
  if (detection.kind === 'matched') {
    return {
      hierarchyPath,
      diffSummary: `Expected variant "${expectedStep.variant}" but detected "${detection.variantId}".`,
      actualScreen: detection.screenId,
      actualVariant: detection.variantId,
      checkedVariants: [],
    };
  }
  if (detection.kind === 'unknown') {
    return {
      hierarchyPath,
      diffSummary: detection.evidence.map((match) => describeFingerprintDiff(match.fingerprint)).join('\n'),
      actualScreen: null,
      actualVariant: null,
      checkedVariants: [...detection.checked],
    };
  }
  return {
    hierarchyPath,
    diffSummary: `Ambiguous match: ${detection.candidates.join(', ')}.`,
    actualScreen: null,
    actualVariant: null,
    checkedVariants: [],
  };
}

/**
 * Analyse a failed run: fresh dump + diff against the expected step.
 *
 * @param store - Variant store for the target platform folder.
 * @param source - Project, platform, and hierarchy source.
 * @param expectedStep - The failed step's expected (screen, variant).
 * @param dir - Run directory for the post-run dump.
 * @param exitCode - Maestro's exit code.
 * @returns The analysis (a dump failure still yields a usable result).
 */
export async function analysePostRun(
  store: VariantStore,
  source: HierarchySource,
  expectedStep: { screen: string; variant: string },
  dir: string,
  exitCode: number,
): Promise<PostRunAnalysis> {
  const fallback = `Maestro exited with code ${exitCode}.`;
  try {
    const { nodes, display } = await loadHierarchy(source);
    const hierarchyPath = saveDump(dir, 'post-run', nodes, display);
    const detection = new DetectVariantUseCase(store).detectForScreen({
      projectRoot: source.projectRoot,
      platform: source.platform,
      screenId: toScreenId(expectedStep.screen),
      nodes,
      display,
    });
    return summariseDetection(detection, expectedStep, hierarchyPath);
  } catch {
    return {
      hierarchyPath: path.join(dir, 'pre-flow-hierarchy.json'),
      diffSummary: `${fallback} Post-run hierarchy dump failed, so no fresh diff is available.`,
      actualScreen: null,
      actualVariant: null,
      checkedVariants: [],
    };
  }
}
