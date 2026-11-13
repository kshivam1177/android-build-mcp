/**
 * Shared hierarchy source for `orbit` CLI commands (detect, learn,
 * run) — one loader, so the commands cannot drift apart.
 *
 * A command takes either a live hierarchy provider or an offline dump
 * file (`--hierarchy-file`, `{ nodes, display }`).
 */
import type { DisplaySize } from '../../core/screen-identity.js';
import { TestOrbitError } from '../../domain/errors.js';
import type { CoreHierarchyNode } from '../../domain/types.js';
import { dumpNodesToCore, readHierarchyDumpFile } from '../../infrastructure/hierarchy-provider.js';
import type { HierarchyProvider } from '../../infrastructure/hierarchy-provider.js';

/** Inputs to loading one hierarchy. */
export interface HierarchySourceOptions {
  /** Offline hierarchy dump file (`{ nodes, display }`). */
  hierarchyFile?: string;
  /** Live hierarchy source; required when no hierarchy file is given. */
  hierarchyProvider?: HierarchyProvider;
}

/**
 * Load the fresh hierarchy from a dump file or a live provider.
 *
 * @param options - Hierarchy source.
 * @returns The dump nodes and display size.
 * @throws TestOrbitError when no hierarchy source is given.
 */
export async function loadHierarchySource(
  options: HierarchySourceOptions,
): Promise<{ nodes: readonly CoreHierarchyNode[]; display: DisplaySize }> {
  if (options.hierarchyFile !== undefined) {
    const dump = readHierarchyDumpFile(options.hierarchyFile);
    return { nodes: dumpNodesToCore(dump), display: dump.display };
  }
  if (options.hierarchyProvider !== undefined) {
    return {
      nodes: await options.hierarchyProvider.dumpHierarchy(),
      display: await options.hierarchyProvider.displaySize(),
    };
  }
  throw new TestOrbitError(
    'INVALID_ARGUMENT',
    'This command needs a hierarchy source: pass --hierarchy-file or run against a live device.',
    'Pass --hierarchy-file <path> with a { nodes, display } dump, or run with a connected device.',
    {},
  );
}
