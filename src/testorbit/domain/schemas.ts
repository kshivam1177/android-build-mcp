/**
 * Zod schemas for every TestOrbit file format touched by Phase 2 (Part D, D4).
 *
 * Every file read from disk is parsed through its schema here; a file that
 * fails validation is rejected with the field named, never silently
 * accepted. Branding happens at this parse boundary only: the schemas
 * validate plain strings, and the `parse*` helpers below brand the ids.
 *
 * Variant files are `screens/<screenId>/variants/<variantId>.json` with
 * `schemaVersion: 2` (B2). A `default` variant with an empty `required`
 * set is forbidden (B2) — it would match everything and disable
 * unknown-variant detection — so the schema rejects it.
 */
import { z } from 'zod';
import { SchemaVersionError } from './errors.js';
import { toElementId, toScreenId, toVariantId } from './types.js';
import type { LearnedScreenElement, ScreenId, StableSelector, VariantDefinition, VariantId } from './types.js';

/** Stable-selector fields only (B5): never text, never bounds. */
export const StableSelectorSchema = z
  .object({
    resourceId: z.string().min(1).optional(),
    contentDesc: z.string().min(1).optional(),
    className: z.string().min(1).optional(),
  })
  .strict();

/** One element of a screen's `elements.json` (base elements, one selector per id). */
export const LearnedScreenElementSchema = z
  .object({
    id: z.string().min(1),
    stableSelector: StableSelectorSchema,
    clickable: z.boolean(),
    enabled: z.boolean(),
    text: z.string().optional(),
    bounds: z
      .object({
        left: z.number(),
        top: z.number(),
        right: z.number(),
        bottom: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** A screen's `screen.json` as written by `orbit_learn_screen` (schema v2). */
export const ScreenDefinitionSchema = z
  .object({
    schemaVersion: z.literal(2),
    screenId: z.string().min(1).max(80),
    title: z.string(),
    appPackage: z.string().nullable(),
    tags: z.array(z.string()),
    appRoute: z.string().nullable(),
    fingerprint: z.string(),
    display: z.object({ width: z.number(), height: z.number() }).strict(),
    capturedAt: z.string(),
    deviceId: z.string(),
    backend: z.string(),
    elementCount: z.number().int().nonnegative(),
    formFieldCount: z.number().int().nonnegative(),
  })
  .strict();

/** One variant file (B2): required/optional/excluded element ids + stamp. */
export const VariantDefinitionSchema = z
  .object({
    schemaVersion: z.literal(2),
    screenId: z.string().min(1).max(80),
    variantId: z.string().min(1).max(80),
    required: z.array(z.string().min(1)).min(1, 'a variant must designate at least one required element'),
    optional: z.array(z.string().min(1)),
    excluded: z.array(z.string().min(1)),
    fingerprintStamp: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    learnedAt: z.string().min(1),
    learnedFrom: z.string().min(1).optional(),
  })
  .strict();

/** Structured fingerprint diff, as serialised for CLI/tool output. */
export const FingerprintDiffSchema = z
  .object({
    matched: z.boolean(),
    missingRequired: z.array(z.string()),
    missingNonRequired: z.array(z.string()),
    added: z.array(z.object({ ref: z.string(), selector: StableSelectorSchema }).strict()),
    changedRequired: z.array(
      z
        .object({
          id: z.string(),
          field: z.enum(['clickable', 'enabled']),
          learned: z.boolean(),
          fresh: z.boolean(),
        })
        .strict(),
    ),
    changedNonRequired: z.array(
      z
        .object({
          id: z.string(),
          field: z.enum(['clickable', 'enabled']),
          learned: z.boolean(),
          fresh: z.boolean(),
        })
        .strict(),
    ),
    excludedPresent: z.array(z.string()),
    warnings: z.array(z.string()),
    budget: z
      .object({
        nonRequiredCount: z.number().int().nonnegative(),
        allowedDrift: z.number().int().nonnegative(),
        usedDrift: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** The added/removed/renamed/changed diff of a safe re-learn (Phase 3). */
export const LearnScreenDiffSchema = z
  .object({
    added: z.array(z.string().min(1)),
    removed: z.array(z.string().min(1)),
    renamed: z
      .array(
        z
          .object({ from: z.string().min(1), to: z.string().min(1) })
          .strict(),
      ),
    changed: z.array(
      z
        .object({
          id: z.string().min(1),
          field: z.enum(['clickable', 'enabled']),
          learned: z.boolean(),
          fresh: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

/** Serialised detection result (B7), as printed by `orbit detect` / `orbit_detect_variant`. */
export const DetectionResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('matched'),
      screenId: z.string(),
      variantId: z.string(),
      evidence: FingerprintDiffSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('unknown'),
      screenId: z.string().nullable(),
      checked: z.array(z.string()),
      evidence: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ambiguous'),
      screenId: z.string().nullable(),
      candidates: z.array(z.string()),
      reason: z.string(),
    })
    .strict(),
]);

/** Human-readable Zod issue list for one failed parse. */
function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/** Brand the string ids of a validated variant definition. */
function brandVariantDefinition(raw: z.infer<typeof VariantDefinitionSchema>): VariantDefinition {
  const definition: VariantDefinition = {
    schemaVersion: 2,
    screenId: toScreenId(raw.screenId),
    variantId: toVariantId(raw.variantId),
    required: raw.required.map(toElementId),
    optional: raw.optional.map(toElementId),
    excluded: raw.excluded.map(toElementId),
    fingerprintStamp: raw.fingerprintStamp,
    learnedAt: raw.learnedAt,
  };
  if (raw.learnedFrom !== undefined) {
    return { ...definition, learnedFrom: raw.learnedFrom };
  }
  return definition;
}

/**
 * Parse and validate one variant file's contents.
 *
 * @param value - Untrusted parsed JSON of the variant file.
 * @param filePath - Path used in the error when validation fails.
 * @returns The branded VariantDefinition.
 * @throws SchemaVersionError naming the failing field.
 */
export function parseVariantDefinition(value: unknown, filePath: string): VariantDefinition {
  const result = VariantDefinitionSchema.safeParse(value);
  if (!result.success) {
    throw new SchemaVersionError(
      `Invalid variant file ${filePath}: ${describeIssues(result.error)}`,
      'Re-learn the variant with orbit learn, or fix the named field by hand.',
      { filePath },
    );
  }
  return brandVariantDefinition(result.data);
}

/**
 * Parse and validate one screen's `elements.json` contents.
 *
 * @param value - Untrusted parsed JSON of the elements file.
 * @param filePath - Path used in the error when validation fails.
 * @returns The branded learned elements.
 * @throws SchemaVersionError naming the failing field.
 */
export function parseScreenElements(value: unknown, filePath: string): LearnedScreenElement[] {
  const result = z.array(LearnedScreenElementSchema).safeParse(value);
  if (!result.success) {
    throw new SchemaVersionError(
      `Invalid elements file ${filePath}: ${describeIssues(result.error)}`,
      'Re-learn the screen with orbit_learn_screen, or fix the named field by hand.',
      { filePath },
    );
  }
  return result.data.map((element) => {
    const selector: StableSelector = {};
    if (element.stableSelector.resourceId !== undefined) selector.resourceId = element.stableSelector.resourceId;
    if (element.stableSelector.contentDesc !== undefined) selector.contentDesc = element.stableSelector.contentDesc;
    if (element.stableSelector.className !== undefined) selector.className = element.stableSelector.className;
    const branded: LearnedScreenElement = {
      id: toElementId(element.id),
      selector,
      clickable: element.clickable,
      enabled: element.enabled,
    };
    if (element.text !== undefined) {
      return { ...branded, text: element.text, ...(element.bounds !== undefined ? { bounds: element.bounds } : {}) };
    }
    if (element.bounds !== undefined) return { ...branded, bounds: element.bounds };
    return branded;
  });
}

/**
 * Parse and validate one detection result for serialisation.
 *
 * @param value - Untrusted detection result JSON.
 * @returns The validated result.
 * @throws SchemaVersionError naming the failing field.
 */
export function parseDetectionResult(value: unknown): z.infer<typeof DetectionResultSchema> {
  const result = DetectionResultSchema.safeParse(value);
  if (!result.success) {
    throw new SchemaVersionError(
      `Invalid detection result: ${describeIssues(result.error)}`,
      'This is a TestOrbit bug — report it with the detection output.',
      {},
    );
  }
  return result.data;
}

/** Brand a screen id string at the parse boundary. */
export function parseScreenId(value: string): ScreenId {
  return toScreenId(value);
}

/** Brand a variant id string at the parse boundary. */
export function parseVariantId(value: string): VariantId {
  return toVariantId(value);
}
