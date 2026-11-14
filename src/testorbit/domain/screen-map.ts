/**
 * Screen-map domain types + Zod schemas (Phase 6, C3).
 *
 * `screen-map.json`, `schemaVersion: 2`, one per platform
 * (`<platform>/screen-map.json`): the learned screens (the index) plus
 * edges from `(screen, variant)` to `(screen, variant)`, each backed by
 * the recordings that prove the transition. The map is a
 * discovery/coverage aid, never a runner gate: a missing edge is a
 * warning, a dangling edge fails `check-screen-map`.
 *
 * Stale-edge rule (C3/C16): an edge whose `to` screen was re-learned
 * since its proving recording is stale until re-proved by a newer
 * recording. Splits/merges require an explicit element-id migration
 * list (`docs/designs/screen-split-merge-migration.md`); the checker
 * fails without one.
 *
 * The checker report (`CheckMapReport`) is the `check-screen-map`
 * output: per-rule findings with the exact rule violated and a
 * remediation, plus per-screen coverage (the B3 ≥80% scope rule:
 * interactive elements carrying a `resourceId` or a unique
 * `contentDesc`).
 */
import { z } from 'zod';
import { SchemaVersionError } from './errors.js';
import { toElementId, toScreenId, toVariantId } from './types.js';
import type { ElementId, Platform, ScreenId, VariantId } from './types.js';

/** One proven transition between two (screen, variant) pairs. */
export interface ScreenMapEdge {
  fromScreen: ScreenId;
  fromVariant: VariantId;
  /** The recorded action type that caused the transition (e.g. `tap`). */
  action: string;
  /** Element id of the action that caused the transition. */
  elementId: ElementId;
  toScreen: ScreenId;
  toVariant: VariantId;
  /** Recording flow ids that prove this transition, sorted. */
  recordings: readonly string[];
  /** True when the `to` screen was re-learned since every proving recording. */
  stale: boolean;
  /** Why the edge is stale, when `stale` is true. */
  staleReason?: string;
}

/** One learned screen as listed in the map index. */
export interface ScreenMapScreenEntry {
  screenId: ScreenId;
  variants: readonly VariantId[];
  elementCount: number;
}

/** Coverage: what was learned vs what any recording ever traversed. */
export interface ScreenMapCoverage {
  screensLearned: number;
  variantsLearned: number;
  edgeCount: number;
  screensNeverTraversed: readonly ScreenId[];
  variantsNeverTraversed: readonly VariantId[];
}

/** The generated screen map (C3), `schemaVersion: 2`, one per platform. */
export interface ScreenMap {
  schemaVersion: 2;
  platform: Platform;
  generatedAt: string;
  screens: readonly ScreenMapScreenEntry[];
  edges: readonly ScreenMapEdge[];
  coverage: ScreenMapCoverage;
}

/** One checker finding: the exact rule violated and how to fix it. */
export interface CheckFinding {
  /** Stable rule code, e.g. `DANGLING_EDGE`. */
  rule: string;
  severity: 'fail' | 'warn';
  message: string;
  remediation: string;
  screenId?: string;
}

/** Per-screen coverage as measured by `check-screen-map` (B3 scope rule). */
export interface PerScreenCheck {
  screenId: ScreenId;
  elementCount: number;
  /** Percent of interactive elements with a resourceId or unique contentDesc. */
  stableCoveragePct: number;
  variantCount: number;
  /** Edges touching this screen (in or out). */
  edgeCount: number;
  traversed: boolean;
}

/** The `check-screen-map` report. */
export interface CheckMapReport {
  schemaVersion: 2;
  platform: Platform;
  checkedAt: string;
  passed: boolean;
  findings: readonly CheckFinding[];
  screens: readonly PerScreenCheck[];
}

/** One element-id migration list (split/merge rule). */
export interface MigrationList {
  schemaVersion: 2;
  migration: string;
  reason: string;
  fromScreen: ScreenId;
  toScreens: readonly ScreenId[];
  mappings: readonly { from: ElementId; to: ElementId }[];
  removed: readonly ElementId[];
  createdAt: string;
}

/** Zod schema for one screen-map edge. */
export const ScreenMapEdgeSchema = z
  .object({
    fromScreen: z.string().min(1),
    fromVariant: z.string().min(1),
    action: z.string().min(1),
    elementId: z.string().min(1),
    toScreen: z.string().min(1),
    toVariant: z.string().min(1),
    recordings: z.array(z.string().min(1)),
    stale: z.boolean(),
    staleReason: z.string().min(1).optional(),
  })
  .strict();

/** Zod schema for one screen-map screen entry. */
export const ScreenMapScreenEntrySchema = z
  .object({
    screenId: z.string().min(1),
    variants: z.array(z.string().min(1)),
    elementCount: z.number().int().nonnegative(),
  })
  .strict();

/** Zod schema for the screen-map coverage block. */
export const ScreenMapCoverageSchema = z
  .object({
    screensLearned: z.number().int().nonnegative(),
    variantsLearned: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    screensNeverTraversed: z.array(z.string().min(1)),
    variantsNeverTraversed: z.array(z.string().min(1)),
  })
  .strict();

/** Zod schema for the whole screen map (C3). */
export const ScreenMapSchema = z
  .object({
    schemaVersion: z.literal(2),
    platform: z.enum(['android', 'ios', 'flutter', 'web']),
    generatedAt: z.string().min(1),
    screens: z.array(ScreenMapScreenEntrySchema),
    edges: z.array(ScreenMapEdgeSchema),
    coverage: ScreenMapCoverageSchema,
  })
  .strict();

/** Zod schema for one element-id migration list. */
export const MigrationListSchema = z
  .object({
    schemaVersion: z.literal(2),
    migration: z.string().min(1),
    reason: z.string().min(1),
    fromScreen: z.string().min(1),
    toScreens: z.array(z.string().min(1)),
    mappings: z.array(
      z.object({ from: z.string().min(1), to: z.string().min(1) }).strict(),
    ),
    removed: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
  })
  .strict();

/** Human-readable Zod issue list for one failed parse. */
function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/** Brand the string ids of a validated edge. */
function brandEdge(raw: z.infer<typeof ScreenMapEdgeSchema>): ScreenMapEdge {
  const edge: ScreenMapEdge = {
    fromScreen: toScreenId(raw.fromScreen),
    fromVariant: toVariantId(raw.fromVariant),
    action: raw.action,
    elementId: toElementId(raw.elementId),
    toScreen: toScreenId(raw.toScreen),
    toVariant: toVariantId(raw.toVariant),
    recordings: [...raw.recordings],
    stale: raw.stale,
  };
  if (raw.staleReason !== undefined) return { ...edge, staleReason: raw.staleReason };
  return edge;
}

/**
 * Parse and validate a screen map's contents.
 *
 * @param value - Untrusted parsed JSON of `screen-map.json`.
 * @param filePath - Path used in the error when validation fails.
 * @returns The branded ScreenMap.
 * @throws SchemaVersionError naming the failing field.
 */
export function parseScreenMap(value: unknown, filePath: string): ScreenMap {
  const result = ScreenMapSchema.safeParse(value);
  if (!result.success) {
    throw new SchemaVersionError(
      `Invalid screen map ${filePath}: ${describeIssues(result.error)}`,
      'Regenerate the map with orbit generate-map.',
      { filePath },
    );
  }
  return {
    schemaVersion: 2,
    platform: result.data.platform,
    generatedAt: result.data.generatedAt,
    screens: result.data.screens.map((entry) => ({
      screenId: toScreenId(entry.screenId),
      variants: entry.variants.map(toVariantId),
      elementCount: entry.elementCount,
    })),
    edges: result.data.edges.map(brandEdge),
    coverage: {
      screensLearned: result.data.coverage.screensLearned,
      variantsLearned: result.data.coverage.variantsLearned,
      edgeCount: result.data.coverage.edgeCount,
      screensNeverTraversed: result.data.coverage.screensNeverTraversed.map(toScreenId),
      variantsNeverTraversed: result.data.coverage.variantsNeverTraversed.map(toVariantId),
    },
  };
}

/**
 * Parse and validate one element-id migration list.
 *
 * @param value - Untrusted parsed JSON of the migration file.
 * @param filePath - Path used in the error when validation fails.
 * @returns The branded MigrationList.
 * @throws SchemaVersionError naming the failing field.
 */
export function parseMigrationList(value: unknown, filePath: string): MigrationList {
  const result = MigrationListSchema.safeParse(value);
  if (!result.success) {
    throw new SchemaVersionError(
      `Invalid migration list ${filePath}: ${describeIssues(result.error)}`,
      'Fix the named field by hand; see docs/designs/screen-split-merge-migration.md.',
      { filePath },
    );
  }
  return {
    schemaVersion: 2,
    migration: result.data.migration,
    reason: result.data.reason,
    fromScreen: toScreenId(result.data.fromScreen),
    toScreens: result.data.toScreens.map(toScreenId),
    mappings: result.data.mappings.map((pair) => ({ from: toElementId(pair.from), to: toElementId(pair.to) })),
    removed: result.data.removed.map(toElementId),
    createdAt: result.data.createdAt,
  };
}
