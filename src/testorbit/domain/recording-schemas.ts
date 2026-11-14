/**
 * Zod schemas for TestOrbit recordings (Part B, B8).
 *
 * Split out of `domain/schemas.ts` so neither file breaches the
 * 300-line cap (Part D): this file owns the recording formats, that
 * file owns screens, variants, and detection results.
 *
 * The one shared reader (`infrastructure/recording-reader.ts`) accepts
 * v1 + v2 and rejects v3+ explicitly. v1 recordings carry no
 * screen/variant/element ids and yield no screen-map edges — they are
 * labelled "unproven / start-stop only". v2 actions carry `screenId`,
 * `variantId`, and `elementId` (populated by the Phase 5 recorder
 * instrumentation) plus an optional `grounding` provenance record:
 * the host agent's fallback chain is hierarchy → Tesseract →
 * LLM vision (D7), and a step grounded by LLM vision is recorded as
 * such, never silently.
 */
import { z } from 'zod';
import { SchemaVersionError } from './errors.js';
import { PlatformSchema } from './types.js';

/** How one recorded action's element was grounded (D7 fallback chain). */
export const GroundingSchema = z
  .object({
    method: z.enum(['hierarchy', 'tesseract', 'llm-vision']),
    detail: z.string().max(500).optional(),
  })
  .strict();
export type ActionGrounding = z.infer<typeof GroundingSchema>;

/** A recorded action's selector (v1 shape: may still carry `text`). */
export const RecordedSelectorSchema = z
  .object({
    resourceId: z.string().min(1).optional(),
    text: z.string().optional(),
    contentDesc: z.string().min(1).optional(),
    className: z.string().min(1).optional(),
  })
  .strict();

/** One recorded action: v1 fields plus the v2 screen/variant/element ids. */
export const RecordedActionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['tap', 'long_press', 'swipe', 'type_text', 'key_press']),
    timestamp: z.string().min(1),
    durationMs: z.number().nonnegative(),
    selector: RecordedSelectorSchema.optional(),
    coordinates: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    normalizedCoordinates: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    swipe: z
      .object({ startX: z.number(), startY: z.number(), endX: z.number(), endY: z.number() })
      .strict()
      .optional(),
    normalizedSwipe: z
      .object({ startX: z.number(), startY: z.number(), endX: z.number(), endY: z.number() })
      .strict()
      .optional(),
    screenSize: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    text: z.string().optional(),
    redacted: z.boolean().optional(),
    keyCode: z.string().optional(),
    screenId: z.string().min(1).optional(),
    variantId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
    /** True when the matched (screen, variant) changed across the action (Phase 5, B8). */
    isNavigationStep: z.boolean().optional(),
    /** Evidence of an unknown screen, or why detection could not run (Phase 5). */
    detectionNote: z.string().max(2000).optional(),
    grounding: GroundingSchema.optional(),
  })
  .strict();
export type TestOrbitRecordedAction = z.infer<typeof RecordedActionSchema>;

/** A recording document, schema v1 or v2 (B8). v2 documents written by the recorder carry `platform`. */
export const RecordingDocumentSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    flowId: z.string().min(1).max(80),
    deviceId: z.string().min(1),
    platform: PlatformSchema.optional(),
    startedAt: z.string().min(1),
    stoppedAt: z.string().min(1),
    durationMs: z.number().nonnegative(),
    actions: z.array(RecordedActionSchema).min(1).max(500),
    screenshots: z.record(z.string(), z.string()),
  })
  .strict();
export type TestOrbitRecordingDocument = z.infer<typeof RecordingDocumentSchema>;

/** Human-readable Zod issue list for one failed parse. */
function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Parse and validate one recording document's contents.
 *
 * @param value - Untrusted parsed JSON of the recording file.
 * @param filePath - Path used in the error when validation fails.
 * @returns The validated recording document (v1 or v2).
 * @throws SchemaVersionError naming the version or the failing field;
 *   v3+ is rejected explicitly, never silently accepted.
 */
export function parseRecording(value: unknown, filePath: string): TestOrbitRecordingDocument {
  if (typeof value === 'object' && value !== null && 'schemaVersion' in value) {
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (typeof version === 'number' && version !== 1 && version !== 2) {
      throw new SchemaVersionError(
        `Unsupported recording schemaVersion ${version} in ${filePath}: this reader accepts v1 and v2 only.`,
        'Re-record the flow, or convert the recording to schema v2.',
        { filePath, schemaVersion: String(version) },
      );
    }
  }
  const result = RecordingDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new SchemaVersionError(
      `Invalid recording file ${filePath}: ${describeIssues(result.error)}`,
      'Re-record the flow, or fix the named field by hand.',
      { filePath },
    );
  }
  return result.data;
}
