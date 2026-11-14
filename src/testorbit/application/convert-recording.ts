/**
 * Converter (Phase 4, C2) — recording → canonical JSON test case
 * (schemaVersion 2) → generated Maestro YAML.
 *
 * Implements the C2 mapping table exactly (recorded action → JSON step
 * → Maestro command + assertion column, including the setup/teardown
 * row, the assert-payload shapes, the final-step row, and the env-var
 * naming rule with the `<testId>.env.example` manifest). The export is
 * one-way/lossy: generated YAML is never re-imported into JSON.
 *
 * Assertion-derivation rule (C1): after each action, the assertion is
 * the *next* action's `(screen, variant)` being present; the final
 * step's assertion is the same rule applied to the final action's own
 * screen. The goal is natural language and is never converted into an
 * assertion — the final assertion is fully mechanical.
 *
 * Form-spec submit (Phase 3 open item, owned here): the submit element
 * is the `elementId` of the last tap before the first navigation step,
 * written into that screen's `form-spec.json`.
 *
 * Secrets: typed values are replaced by `${ENV_VAR}` references at
 * conversion time and never appear literally in YAML, JSON, logs, or
 * the env manifest (names only, no values).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { envVarFor, maestroKeyName, swipeDirection } from '../core/assertions.js';
import { ConversionError } from '../domain/errors.js';
import { parseTestCase } from '../domain/testcase-schemas.js';
import type { TestCase, TestCaseStep } from '../domain/testcase-schemas.js';
import type { TestOrbitRecordingDocument } from '../domain/recording-schemas.js';
import { toElementId, toTestId } from '../domain/types.js';
import type { ElementId, Platform, ScreenId, TestId } from '../domain/types.js';
import { annotateRecording } from './annotate-recording.js';
import type { AnnotatedAction, GroundedElementOverride } from './annotate-recording.js';
import { buildMaestroFlow, elementSelectorMap, renderFlowYaml } from './maestro-export.js';
import type { LoadingIndicator } from './maestro-export.js';
import { getPlatformDir, readFileText, writeFileAtomic, writeFileWithBackup } from '../infrastructure/filesystem.js';
import type { VariantStore } from '../infrastructure/variant-store.js';

/** Default per-step timeout (C1): 3,000 ms. */
export const DEFAULT_STEP_TIMEOUT_MS = 3000;
/** Per-step timeout for navigation/load steps (C1): 10,000 ms. */
export const NAVIGATION_STEP_TIMEOUT_MS = 10000;

/** Inputs to one conversion. */
export interface ConvertRecordingInput {
  projectRoot: string;
  platform: Platform;
  recording: TestOrbitRecordingDocument;
  testId: TestId;
  /** Plain-language goal; defaults to the recording's flow id. */
  goal?: string;
  /** Maestro app id; falls back to the learned screens' appPackage. */
  appId?: string;
  /** Loading indicators per screen id (navigation steps only). */
  loadingIndicators?: Readonly<Record<string, LoadingIndicator>>;
  /** Host-agent LLM-vision grounding overrides, by action id (D7). */
  groundingOverrides?: readonly GroundedElementOverride[];
}

/** Outcome of one conversion. */
export interface ConvertRecordingResult {
  testCase: TestCase;
  yamlText: string;
  testCasePath: string;
  yamlPath: string;
  envExamplePath: string;
  envVars: readonly string[];
  /** Submit element id, or null when there is no navigation step. */
  submitElementId: ElementId | null;
  warnings: readonly string[];
}

/** One JSON step plus the Maestro command inputs it carries. */
function stepOf(
  annotated: AnnotatedAction,
  index: number,
  next: AnnotatedAction | undefined,
  envVars: string[],
): TestCaseStep {
  const { action } = annotated;
  const target = next ?? annotated;
  const timeoutMs = next !== undefined && (next.screenId !== annotated.screenId || next.variantId !== annotated.variantId)
    ? NAVIGATION_STEP_TIMEOUT_MS
    : DEFAULT_STEP_TIMEOUT_MS;
  const step: TestCaseStep = {
    index,
    screen: annotated.screenId,
    variant: annotated.variantId,
    action: action.type === 'type_text' ? 'type' : action.type === 'key_press' ? 'key' : action.type,
    timeoutMs,
    assert: { kind: 'variant-present', variant: target.variantId },
  };
  if (annotated.elementId !== null) step.elementId = annotated.elementId;
  if (annotated.groundedBy !== undefined) step.groundedBy = annotated.groundedBy;
  if (action.type === 'type_text') {
    const elementId = annotated.elementId ?? toElementId(`${annotated.screenId}.unknown`);
    const envVar = envVarFor(annotated.screenId, elementId);
    envVars.push(envVar);
    step.text = `\${${envVar}}`;
  }
  if (action.type === 'swipe') {
    const swipe = action.normalizedSwipe ?? action.swipe;
    if (swipe !== undefined) {
      step.direction = swipeDirection(
        { x: swipe.startX, y: swipe.startY },
        { x: swipe.endX, y: swipe.endY },
      );
    }
    if (action.durationMs > 0) step.durationMs = action.durationMs;
  }
  if (action.type === 'key_press' && action.keyCode !== undefined) step.keyCode = maestroKeyName(action.keyCode);
  return step;
}

/** SHA-256 hex of one string (source JSON hash for the YAML header). */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The `appId` for the flow: explicit, else the first learned screen's package. */
function resolveAppId(
  input: ConvertRecordingInput,
  annotated: readonly AnnotatedAction[],
): string {
  if (input.appId !== undefined) return input.appId;
  const screens = new Set(annotated.map((item) => item.screenId));
  for (const screenId of screens) {
    const screenFile = path.join(
      getPlatformDir(input.projectRoot, input.platform),
      'screens',
      screenId,
      'screen.json',
    );
    if (!fs.existsSync(screenFile)) continue;
    try {
      const parsed = JSON.parse(readFileText(screenFile)) as { appPackage?: unknown };
      if (typeof parsed.appPackage === 'string' && parsed.appPackage.length > 0) return parsed.appPackage;
    } catch {
      continue;
    }
  }
  throw new ConversionError(
    'Cannot convert: no appId is known for this flow.',
    'Pass --app-id, or learn the screens so screen.json carries an appPackage.',
    { testId: input.testId },
  );
}

/** Convert annotated actions into canonical JSON steps. */
function buildSteps(annotated: readonly AnnotatedAction[]): { steps: TestCaseStep[]; envVars: string[] } {
  const envVars: string[] = [];
  const steps = annotated.map((item, position) => stepOf(item, position + 1, annotated[position + 1], envVars));
  return { steps, envVars: [...new Set(envVars)] };
}

/** Last tap step before the first navigation step, or null. */
function submitStep(annotated: readonly AnnotatedAction[]): AnnotatedAction | null {
  let firstNavigation = -1;
  for (let i = 1; i < annotated.length; i += 1) {
    const current = annotated[i];
    const previous = annotated[i - 1];
    if (current === undefined || previous === undefined) continue;
    if (current.screenId !== previous.screenId || current.variantId !== previous.variantId) {
      firstNavigation = i;
      break;
    }
  }
  if (firstNavigation < 0) return null;
  for (let i = firstNavigation - 1; i >= 0; i -= 1) {
    const candidate = annotated[i];
    if (candidate !== undefined && candidate.action.type === 'tap' && candidate.elementId !== null) return candidate;
  }
  return null;
}

/** Write the submit element id into a screen's form-spec.json, when it exists. */
function writeSubmitElement(
  input: ConvertRecordingInput,
  screenId: ScreenId,
  submitElementId: ElementId,
): { warnings: string[] } {
  const formSpecPath = path.join(
    getPlatformDir(input.projectRoot, input.platform),
    'screens',
    screenId,
    'form-spec.json',
  );
  if (!fs.existsSync(formSpecPath)) {
    return {
      warnings: [`No form-spec.json for screen "${screenId}": submit element "${submitElementId}" not recorded.`],
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileText(formSpecPath)) as Record<string, unknown>;
  } catch {
    return {
      warnings: [`form-spec.json for screen "${screenId}" is not valid JSON: submit element not recorded.`],
    };
  }
  writeFileWithBackup(formSpecPath, `${JSON.stringify({ ...parsed, submitButton: submitElementId }, null, 2)}\n`);
  return { warnings: [] };
}

/** Convert one recording into a canonical test case + Maestro YAML. */
export class ConvertRecordingUseCase {
  /**
   * @param store - Variant store for the target platform folder.
   */
  constructor(private readonly store: VariantStore) {}

  /**
   * Convert a recording.
   *
   * @param input - Project, platform, recording, test id, and options.
   * @returns The test case, YAML, output paths, env vars, and submit element.
   * @throws ConversionError naming the step or element on any unmappable input.
   */
  convert(input: ConvertRecordingInput): ConvertRecordingResult {
    const screens = this.store.loadAllScreens();
    const annotated = annotateRecording(input.recording, screens, input.groundingOverrides ?? []);
    const { steps, envVars } = buildSteps(annotated);
    const testCase: TestCase = parseTestCase(
      {
        schemaVersion: 2,
        id: input.testId,
        goal: input.goal ?? input.recording.flowId,
        setup: { clearAppData: true, launchApp: true, disableAnimations: true },
        teardown: { clearAppData: true },
        provenance: { model: 'unknown', promptHash: 'unknown' },
        steps,
      },
      `${input.testId}.json`,
    );
    const appId = resolveAppId(input, annotated);
    const selectorMap = elementSelectorMap(screens);
    const flow = buildMaestroFlow(testCase, screens, (elementId) => {
      const selector = selectorMap.get(elementId);
      if (selector === undefined) {
        throw new ConversionError(
          `Element "${elementId}" has no learned selector on this platform.`,
          'Learn the screen first with orbit learn.',
          { elementId },
        );
      }
      return selector;
    }, { appId, ...(input.loadingIndicators !== undefined ? { loadingIndicators: input.loadingIndicators } : {}) });
    const yamlText = renderFlowYaml(flow, {
      sourceHash: sha256Hex(JSON.stringify(testCase)),
      generatedAt: new Date().toISOString(),
      schemaVersion: 2,
    });
    return this.writeOutputs(input, testCase, yamlText, envVars, annotated);
  }

  /** Write the JSON test case, YAML, and env manifest; record the submit element. */
  private writeOutputs(
    input: ConvertRecordingInput,
    testCase: TestCase,
    yamlText: string,
    envVars: readonly string[],
    annotated: readonly AnnotatedAction[],
  ): ConvertRecordingResult {
    const platformDir = getPlatformDir(input.projectRoot, input.platform);
    const testCasePath = path.join(platformDir, 'testcases', `${input.testId}.json`);
    const yamlPath = path.join(platformDir, 'tests', `${input.testId}.yaml`);
    const envExamplePath = path.join(platformDir, 'testcases', `${input.testId}.env.example`);
    writeFileAtomic(testCasePath, `${JSON.stringify(testCase, null, 2)}\n`);
    writeFileAtomic(yamlPath, yamlText);
    const envExample = [
      `# TestOrbit env manifest for ${input.testId} — names only, no values.`,
      '# Load these from the environment at test setup; never commit values.',
      ...envVars.map((name) => `${name}=`),
    ].join('\n');
    writeFileAtomic(envExamplePath, `${envExample}\n`);
    const submit = submitStep(annotated);
    if (submit === null || submit.elementId === null) {
      return {
        testCase,
        yamlText,
        testCasePath,
        yamlPath,
        envExamplePath,
        envVars,
        submitElementId: null,
        warnings: [],
      };
    }
    const written = writeSubmitElement(input, submit.screenId, submit.elementId);
    return {
      testCase,
      yamlText,
      testCasePath,
      yamlPath,
      envExamplePath,
      envVars,
      submitElementId: submit.elementId,
      warnings: written.warnings,
    };
  }
}

/** Brand a test id string (parse boundary for CLI/tool inputs). */
export function testIdFromInput(value: string): TestId {
  return toTestId(value);
}
