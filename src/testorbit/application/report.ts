/**
 * Run report + failure bundle writer (Part A duties 3–4, Part D D6).
 *
 * One run directory per run:
 * `<platform>/test-reports/<yyyy-mm-dd>/<hhmmss>-testorbit-<runId>/`,
 * holding `run-report.json`, the hierarchy dumps, and the failure
 * bundle when the run fails. The report distinguishes plan / record /
 * replay LLM counts, and the replay count is always 0 — the Runner
 * records 0 for the replay portion it owns; the host agent reports its
 * own plan/record counts. Typed values are redacted at this boundary
 * via the one shared redactor.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../core/redact.js';
import { parseScreenMap } from '../domain/screen-map.js';
import type { ScreenMapCoverage } from '../domain/screen-map.js';
import type { FailureBundle, RunReport, RunReportStep } from '../domain/testcase-schemas.js';
import type { Platform } from '../domain/types.js';
import { getPlatformDir, readFileText, writeFileAtomic } from '../infrastructure/filesystem.js';

/** Create one run directory and return its path and run id. */
export function createRunDir(projectRoot: string, platform: Platform): { dir: string; runId: string } {
  const runId = randomUUID().slice(0, 8);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const dir = path.join(getPlatformDir(projectRoot, platform), 'test-reports', date, `${time}-testorbit-${runId}`);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, runId };
}

/** Inputs to building one run report. */
export interface BuildReportInput {
  testId: string;
  platform: Platform;
  startedAt: string;
  durationMs: number;
  success: boolean;
  llmCallsPlan: number;
  llmCallsRecord: number;
  steps: readonly RunReportStep[];
  /** Map coverage at run time (Phase 6 task 5); omit when no map exists. */
  coverage?: ScreenMapCoverage;
  maestroReportPath?: string;
  failureBundlePath?: string;
  error?: string;
}

/**
 * Build one run report (replay LLM calls are always 0).
 *
 * @param input - Run outcome.
 * @returns The validated-shape report (schema v2).
 */
export function buildRunReport(input: BuildReportInput): RunReport {
  const report: RunReport = {
    schemaVersion: 2,
    testId: input.testId,
    platform: input.platform,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    success: input.success,
    llmCalls: { plan: input.llmCallsPlan, record: input.llmCallsRecord, replay: 0 },
    steps: [...input.steps],
  };
  if (input.coverage !== undefined) {
    // The Zod-inferred report shape carries plain strings; the domain
    // coverage block carries branded readonly ids. Copy both across.
    report.coverage = {
      screensLearned: input.coverage.screensLearned,
      variantsLearned: input.coverage.variantsLearned,
      edgeCount: input.coverage.edgeCount,
      screensNeverTraversed: [...input.coverage.screensNeverTraversed],
      variantsNeverTraversed: [...input.coverage.variantsNeverTraversed],
    };
  }
  if (input.maestroReportPath !== undefined) report.maestroReportPath = input.maestroReportPath;
  if (input.failureBundlePath !== undefined) report.failureBundlePath = input.failureBundlePath;
  if (input.error !== undefined) report.error = input.error;
  return report;
}

/**
 * Read the map coverage block for a run report (Phase 6 task 5).
 *
 * The coverage is copied from `<platform>/screen-map.json` when the
 * map exists; a missing or unreadable map yields `undefined` and the
 * report simply has no coverage block — a missing map must never fail
 * a run (the map is a discovery aid, never a runner gate).
 *
 * @param projectRoot - Project root holding the platform folder.
 * @param platform - Target platform.
 * @returns The map's coverage block, or `undefined` when there is no usable map.
 */
export function readRunCoverage(
  projectRoot: string,
  platform: Platform,
): ScreenMapCoverage | undefined {
  const mapPath = path.join(getPlatformDir(projectRoot, platform), 'screen-map.json');
  if (!fs.existsSync(mapPath)) return undefined;
  try {
    return parseScreenMap(JSON.parse(readFileText(mapPath)) as unknown, mapPath).coverage;
  } catch {
    return undefined;
  }
}

/**
 * Write one run report into its run directory.
 *
 * @param dir - Run directory from `createRunDir`.
 * @param report - Report to write.
 * @returns The absolute report path.
 */
export function writeRunReport(dir: string, report: RunReport): string {
  const reportPath = path.join(dir, 'run-report.json');
  writeFileAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

/**
 * Write one failure bundle (step, expected vs actual, element diff,
 * hierarchy path, screenshot path, exact rerun command), redacting
 * any supplied secrets from its text fields.
 *
 * @param dir - Run directory from `createRunDir`.
 * @param bundle - Bundle to write.
 * @param secrets - Secret values to redact (typed values, tokens).
 * @returns The absolute bundle path.
 */
export function writeFailureBundle(dir: string, bundle: FailureBundle, secrets: readonly string[]): string {
  const redacted: FailureBundle = {
    ...bundle,
    actual: {
      ...bundle.actual,
      diffSummary: redactSecrets(bundle.actual.diffSummary, secrets),
    },
    rerunCommand: redactSecrets(bundle.rerunCommand, secrets),
  };
  const bundlePath = path.join(dir, 'failure-bundle.json');
  writeFileAtomic(bundlePath, `${JSON.stringify(redacted, null, 2)}\n`);
  return bundlePath;
}
