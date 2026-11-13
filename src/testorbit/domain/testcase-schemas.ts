/**
 * Zod schemas for the canonical JSON test case, the run report, and the
 * failure bundle (Part C, C1 + Part A Runner duties).
 *
 * Split out of `domain/schemas.ts` so neither file breaches the
 * 300-line cap (Part D). The canonical test case is
 * `testcases/<testId>.json`, `schemaVersion: 2`; readers reject unknown
 * versions. `setup`/`teardown` are mandatory; `provenance` is
 * mandatory with `"unknown"` allowed where the host agent cannot
 * supply a value. A copied test carries `provenance.copiedFrom` and
 * `verificationStatus: "copied-unverified"` until its first green run
 * on the target platform (C4).
 */
import { z } from 'zod';
import { SchemaVersionError } from './errors.js';
import { ScreenMapCoverageSchema } from './screen-map.js';
import { PlatformSchema } from './types.js';

/** Setup run before the flow (C1/C2): launch with cleared app data. */
export const TestCaseSetupSchema = z
  .object({
    clearAppData: z.boolean(),
    launchApp: z.boolean(),
    disableAnimations: z.boolean(),
  })
  .strict();
export type TestCaseSetup = z.infer<typeof TestCaseSetupSchema>;

/** Teardown run after the flow (C1/C2). */
export const TestCaseTeardownSchema = z.object({ clearAppData: z.boolean() }).strict();
export type TestCaseTeardown = z.infer<typeof TestCaseTeardownSchema>;

/** Provenance (C1): `"unknown"` is allowed where it cannot be supplied. */
export const TestCaseProvenanceSchema = z
  .object({
    model: z.string().min(1),
    promptHash: z.string().min(1),
    appVersion: z.string().min(1).optional(),
    gitHeadSha: z.string().min(1).optional(),
    device: z.string().min(1).optional(),
    copiedFrom: z.object({ platform: PlatformSchema, testId: z.string().min(1) }).strict().optional(),
  })
  .strict();
export type TestCaseProvenance = z.infer<typeof TestCaseProvenanceSchema>;

/** One assertion target: an element id or a visible-text substring. */
export const AssertTargetSchema = z.union([
  z.object({ id: z.string().min(1) }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
]);
export type AssertTarget = z.infer<typeof AssertTargetSchema>;

/** Assertion kinds (C1/C2 assert-payload shapes). */
export const TestCaseAssertSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('variant-present'), variant: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('visible'), target: AssertTargetSchema }).strict(),
  z.object({ kind: z.literal('contains'), text: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('not_visible'), target: AssertTargetSchema }).strict(),
  z.object({ kind: z.literal('not_contains'), text: z.string().min(1) }).strict(),
]);
export type TestCaseAssert = z.infer<typeof TestCaseAssertSchema>;

/** One canonical test-case step (C1). */
export const TestCaseStepSchema = z
  .object({
    index: z.number().int().positive(),
    screen: z.string().min(1),
    variant: z.string().min(1),
    action: z.enum(['tap', 'type', 'long_press', 'swipe', 'key']),
    elementId: z.string().min(1).optional(),
    text: z.string().optional(),
    direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']).optional(),
    durationMs: z.number().int().positive().optional(),
    keyCode: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive(),
    assert: TestCaseAssertSchema,
    groundedBy: z.enum(['hierarchy', 'tesseract', 'llm-vision']).optional(),
  })
  .strict();
export type TestCaseStep = z.infer<typeof TestCaseStepSchema>;

/** The canonical JSON test case (C1), schema v2. */
export const TestCaseSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().min(1).max(80),
    goal: z.string().min(1),
    setup: TestCaseSetupSchema,
    teardown: TestCaseTeardownSchema,
    provenance: TestCaseProvenanceSchema,
    steps: z.array(TestCaseStepSchema).min(1),
    verificationStatus: z.enum(['copied-unverified', 'verified']).optional(),
  })
  .strict();
export type TestCase = z.infer<typeof TestCaseSchema>;

/** One step of a TestOrbit run report. */
export const RunReportStepSchema = z
  .object({
    index: z.number().int().nonnegative(),
    command: z.string().min(1),
    status: z.enum(['passed', 'failed', 'skipped']),
    durationMs: z.number().nonnegative().nullable(),
    message: z.string().optional(),
  })
  .strict();
export type RunReportStep = z.infer<typeof RunReportStepSchema>;

/** The TestOrbit run report (Part A duty 4; format standardised Phase 9). */
export const RunReportSchema = z
  .object({
    schemaVersion: z.literal(2),
    testId: z.string().min(1),
    platform: PlatformSchema,
    startedAt: z.string().min(1),
    durationMs: z.number().nonnegative(),
    success: z.boolean(),
    llmCalls: z.object({ plan: z.number().int().nonnegative(), record: z.number().int().nonnegative(), replay: z.literal(0) }).strict(),
    steps: z.array(RunReportStepSchema),
    /**
     * Map coverage at run time (Phase 6 task 5, standardised Phase 9):
     * screens/variants learned, edges, and what no recording ever
     * traversed — copied from `<platform>/screen-map.json` when the
     * map exists. Absent when the tree has no generated map yet.
     */
    coverage: ScreenMapCoverageSchema.optional(),
    maestroReportPath: z.string().optional(),
    failureBundlePath: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
export type RunReport = z.infer<typeof RunReportSchema>;

/** The post-run failure bundle (Part A duty 3). */
export const FailureBundleSchema = z
  .object({
    schemaVersion: z.literal(2),
    testId: z.string().min(1),
    platform: PlatformSchema,
    failedStep: z.number().int().nonnegative(),
    expected: z.object({ screen: z.string().min(1), variant: z.string().min(1) }).strict(),
    actual: z
      .object({
        screen: z.string().nullable(),
        variant: z.string().nullable(),
        diffSummary: z.string(),
        checkedVariants: z.array(z.string()),
      })
      .strict(),
    hierarchyPath: z.string().min(1),
    screenshotPath: z.string().nullable(),
    rerunCommand: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();
export type FailureBundle = z.infer<typeof FailureBundleSchema>;

/** Human-readable Zod issue list for one failed parse. */
function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Parse and validate one canonical test case's contents.
 *
 * @param value - Untrusted parsed JSON of the test-case file.
 * @param filePath - Path used in the error when validation fails.
 * @returns The validated test case.
 * @throws SchemaVersionError naming the failing field.
 */
export function parseTestCase(value: unknown, filePath: string): TestCase {
  const result = TestCaseSchema.safeParse(value);
  if (!result.success) {
    throw new SchemaVersionError(
      `Invalid test case file ${filePath}: ${describeIssues(result.error)}`,
      'Regenerate the test case with orbit convert, or fix the named field by hand.',
      { filePath },
    );
  }
  return result.data;
}
