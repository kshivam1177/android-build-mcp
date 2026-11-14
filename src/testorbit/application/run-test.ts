/**
 * TestOrbit Runner (Part A decision, Phase 4) — the thin wrapper CLI around
 * Maestro, owning exactly the five duties a wrapper *can* do:
 *
 * 1. Before a flow (pre-flow only): dump a fresh hierarchy, run screen
 *    identification + variant detection, and select the Maestro flow
 *    for the detected `(screen, variant)`. On mismatch it fails with
 *    evidence and never runs Maestro against an unknown screen.
 * 2. Run `maestro test` for the selected flow.
 * 3. After a run (post-run only): on failure, dump the current
 *    hierarchy, compute the element diff against the expected
 *    `(screen, variant)`, and write the failure bundle file.
 * 4. Record timing: per-step wall time from Maestro's own report, plus
 *    the total duration; the LLM-call counter records 0 for replay.
 * 5. Variant assertion: the first step's `assertVisible` is emitted by
 *    the converter, not evaluated by the Runner.
 *
 * Mid-run verification is explicitly NOT a Runner duty — checks during
 * a run are the Maestro assertions the converter emits. There is no
 * per-segment Maestro invocation and no repo-side executor path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describeFingerprintDiff } from '../core/fingerprint.js';
import { RunnerError } from '../domain/errors.js';
import { parseTestCase } from '../domain/testcase-schemas.js';
import type { FailureBundle, RunReport, RunReportStep } from '../domain/testcase-schemas.js';
import type { Platform, TestId } from '../domain/types.js';
import { toScreenId, toTestId } from '../domain/types.js';
import { DetectVariantUseCase } from './detect-variant.js';
import { buildRunReport, createRunDir, readRunCoverage, writeFailureBundle, writeRunReport } from './report.js';
import { analysePostRun, loadHierarchy, saveDump } from './post-run-analysis.js';
import type { HierarchyProvider } from '../infrastructure/hierarchy-provider.js';
import { MaestroRunner } from '../infrastructure/maestro-runner.js';
import { getPlatformDir, readFileText } from '../infrastructure/filesystem.js';
import type { VariantStore } from '../infrastructure/variant-store.js';

/** Inputs to one Runner run. */
export interface RunTestInput {
  projectRoot: string;
  platform: Platform;
  testId: TestId;
  /** Live hierarchy source; required when no hierarchy file is given. */
  hierarchyProvider?: HierarchyProvider;
  /** Offline hierarchy dump file (`{ nodes, display }`). */
  hierarchyFile?: string;
  /** Host-agent LLM counts (plan/record); replay is always 0. */
  llmCalls?: { plan?: number; record?: number };
  /** Secret values to redact from the report and bundle. */
  secrets?: readonly string[];
}

/** Outcome of one Runner run. */
export interface RunTestResult {
  report: RunReport;
  reportPath: string;
  failureBundlePath: string | null;
  success: boolean;
}

/** Steps for the report when Maestro produced no per-step timings. */
function fallbackSteps(
  stepCount: number,
  success: boolean,
): RunReportStep[] {
  const steps: RunReportStep[] = [];
  for (let i = 0; i < stepCount; i += 1) {
    steps.push({ index: i + 1, command: `step ${i + 1}`, status: success ? 'passed' : 'failed', durationMs: null });
  }
  return steps;
}

/** The TestOrbit Runner use case. */
export class RunTestUseCase {
  /**
   * @param store - Variant store for the target platform folder.
   * @param maestro - Maestro runner (injectable; defaults to the real subprocess).
   */
  constructor(
    private readonly store: VariantStore,
    private readonly maestro: MaestroRunner = new MaestroRunner(),
  ) {}

  /**
   * Run one saved test via the TestOrbit Runner.
   *
   * @param input - Project, platform, test id, and hierarchy source.
   * @returns The report, its path, and the failure-bundle path (if any).
   * @throws RunnerError when the test case or YAML is missing, or Maestro is not installed.
   */
  async run(input: RunTestInput): Promise<RunTestResult> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const platformDir = getPlatformDir(input.projectRoot, input.platform);
    const testCasePath = path.join(platformDir, 'testcases', `${input.testId}.json`);
    if (!fs.existsSync(testCasePath)) {
      throw new RunnerError(
        `No test case "${input.testId}" on platform "${input.platform}" (${testCasePath}).`,
        `Generate it first: orbit convert --recording <flowId> --test ${input.testId} --platform ${input.platform}`,
        { testId: input.testId, platform: input.platform },
      );
    }
    const testCase = parseTestCase(JSON.parse(readFileText(testCasePath)) as unknown, testCasePath);
    const yamlPath = path.join(platformDir, 'tests', `${input.testId}.yaml`);
    if (!fs.existsSync(yamlPath)) {
      throw new RunnerError(
        `No Maestro YAML for test "${input.testId}" (${yamlPath}).`,
        `Generate it first: orbit convert --recording <flowId> --test ${input.testId} --platform ${input.platform}`,
        { testId: input.testId, platform: input.platform },
      );
    }
    const firstStep = testCase.steps[0];
    if (firstStep === undefined) {
      throw new RunnerError(
        `Test case "${input.testId}" has no steps.`,
        `Regenerate it: orbit convert --recording <flowId> --test ${input.testId} --platform ${input.platform}`,
        { testId: input.testId },
      );
    }
    const { dir } = createRunDir(input.projectRoot, input.platform);
    const preFlow = await this.preFlowCheck(input, firstStep, dir);
    if (preFlow !== null) return preFlow;
    const result = await this.maestro.runFlow(yamlPath, dir);
    if (result.success) return this.finishSuccess(input, testCase, result, startedAt, started, dir);
    return this.finishFailure(input, testCase, result, startedAt, started, dir);
  }

  /** Pre-flow detection; returns a failure result when the screen/variant mismatches. */
  private async preFlowCheck(
    input: RunTestInput,
    firstStep: { screen: string; variant: string },
    dir: string,
  ): Promise<RunTestResult | null> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const { nodes, display } = await loadHierarchy(input);
    const dumpPath = saveDump(dir, 'pre-flow', nodes, display);
    const useCase = new DetectVariantUseCase(this.store);
    const detection = useCase.detectForScreen({
      projectRoot: input.projectRoot,
      platform: input.platform,
      screenId: toScreenId(firstStep.screen),
      nodes,
      display,
    });
    if (detection.kind === 'matched' && detection.variantId === firstStep.variant) return null;
    const diffSummary =
      detection.kind === 'matched'
        ? `Expected variant "${firstStep.variant}" but detected "${detection.variantId}".`
        : detection.kind === 'unknown'
          ? detection.evidence.map((match) => describeFingerprintDiff(match.fingerprint)).join('\n')
          : `Ambiguous match: ${detection.candidates.join(', ')}.`;
    return this.writeFailure(input, {
      dir,
      startedAt,
      started,
      failedStep: 0,
      expected: firstStep,
      actualScreen: detection.kind === 'matched' ? detection.screenId : null,
      actualVariant: detection.kind === 'matched' ? detection.variantId : null,
      diffSummary,
      checkedVariants: detection.kind === 'unknown' ? [...detection.checked] : [],
      hierarchyPath: dumpPath,
      error: `Pre-flow detection failed: ${diffSummary}`,
      maestroReportPath: undefined,
    });
  }

  /** Build one failure bundle (without writing it). */
  private buildFailureBundle(
    input: RunTestInput,
    failure: {
      failedStep: number;
      expected: { screen: string; variant: string };
      actualScreen: string | null;
      actualVariant: string | null;
      diffSummary: string;
      checkedVariants: readonly string[];
      hierarchyPath: string;
    },
  ): FailureBundle {
    return {
      schemaVersion: 2,
      testId: input.testId,
      platform: input.platform,
      failedStep: failure.failedStep,
      expected: failure.expected,
      actual: {
        screen: failure.actualScreen,
        variant: failure.actualVariant,
        diffSummary: failure.diffSummary,
        checkedVariants: [...failure.checkedVariants],
      },
      hierarchyPath: failure.hierarchyPath,
      screenshotPath: null,
      rerunCommand: `orbit run --test ${input.testId} --platform ${input.platform}`,
      createdAt: new Date().toISOString(),
    };
  }

  /** Write a failure bundle + report for a failed run (pre-flow or post-run). */
  private writeFailure(
    input: RunTestInput,
    failure: {
      dir: string;
      startedAt: string;
      started: number;
      failedStep: number;
      expected: { screen: string; variant: string };
      actualScreen: string | null;
      actualVariant: string | null;
      diffSummary: string;
      checkedVariants: readonly string[];
      hierarchyPath: string;
      error: string;
      maestroReportPath: string | undefined;
    },
  ): RunTestResult {
    const bundlePath = writeFailureBundle(failure.dir, this.buildFailureBundle(input, failure), input.secrets ?? []);
    const coverage = readRunCoverage(input.projectRoot, input.platform);
    const report = buildRunReport({
      testId: input.testId,
      platform: input.platform,
      startedAt: failure.startedAt,
      durationMs: Date.now() - failure.started,
      success: false,
      llmCallsPlan: input.llmCalls?.plan ?? 0,
      llmCallsRecord: input.llmCalls?.record ?? 0,
      steps: [],
      ...(coverage !== undefined ? { coverage } : {}),
      failureBundlePath: bundlePath,
      error: failure.error,
      ...(failure.maestroReportPath !== undefined ? { maestroReportPath: failure.maestroReportPath } : {}),
    });
    return { report, reportPath: writeRunReport(failure.dir, report), failureBundlePath: bundlePath, success: false };
  }

  /** Finish a passing run: report with Maestro per-step timings. */
  private finishSuccess(
    input: RunTestInput,
    testCase: { steps: readonly { action: string }[] },
    result: Awaited<ReturnType<MaestroRunner['runFlow']>>,
    startedAt: string,
    started: number,
    dir: string,
  ): RunTestResult {
    const steps: RunReportStep[] =
      result.commandTimings.length > 0
        ? result.commandTimings.map((timing, index) => ({
            index: index + 1,
            command: timing.command,
            status: timing.status === 'unknown' ? 'passed' : timing.status,
            durationMs: timing.durationMs,
          }))
        : fallbackSteps(testCase.steps.length, true);
    const coverage = readRunCoverage(input.projectRoot, input.platform);
    const report = buildRunReport({
      testId: input.testId,
      platform: input.platform,
      startedAt,
      durationMs: Date.now() - started,
      success: true,
      llmCallsPlan: input.llmCalls?.plan ?? 0,
      llmCallsRecord: input.llmCalls?.record ?? 0,
      steps,
      ...(coverage !== undefined ? { coverage } : {}),
      ...(result.junitPath !== null ? { maestroReportPath: result.junitPath } : {}),
    });
    return { report, reportPath: writeRunReport(dir, report), failureBundlePath: null, success: true };
  }

  /** Finish a failing Maestro run: post-run failure analysis + bundle. */
  private async finishFailure(
    input: RunTestInput,
    testCase: { steps: readonly { screen: string; variant: string; action: string }[] },
    result: Awaited<ReturnType<MaestroRunner['runFlow']>>,
    startedAt: string,
    started: number,
    dir: string,
  ): Promise<RunTestResult> {
    const failedIndex = result.commandTimings.findIndex((timing) => timing.status === 'failed');
    const failedStep = failedIndex >= 0 ? failedIndex : 0;
    const expectedStep = testCase.steps[Math.min(failedStep, testCase.steps.length - 1)];
    if (expectedStep === undefined) {
      throw new RunnerError(
        `Test case "${input.testId}" has no steps to attribute the failure to.`,
        'Regenerate the test case with orbit convert.',
        { testId: input.testId },
      );
    }
    const analysis = await analysePostRun(this.store, input, expectedStep, dir, result.exitCode);
    return this.writeFailure(input, {
      dir,
      startedAt,
      started,
      failedStep,
      expected: expectedStep,
      actualScreen: analysis.actualScreen,
      actualVariant: analysis.actualVariant,
      diffSummary: analysis.diffSummary,
      checkedVariants: analysis.checkedVariants,
      hierarchyPath: analysis.hierarchyPath,
      error: `Maestro run failed (exit code ${result.exitCode}).`,
      maestroReportPath: result.junitPath ?? undefined,
    });
  }
}

/** Brand a test id string (parse boundary for CLI inputs). */
export function testIdFromCli(value: string): TestId {
  return toTestId(value);
}
