/**
 * Cross-platform copy (Part C, C4) — replicate a test from one
 * platform to another.
 *
 * The flow (steps, goal, assertions) copies; each step's `elementId`
 * is re-resolved against the target platform's learned screens, in
 * the plan's own order: stable-selector fields → unique contentDesc →
 * className + the B3 sibling index within the identical-selector group
 * under the same parent. Never raw text, never raw list order.
 * Anything that does not match by one of those three rules fails the
 * copy loudly naming the step and the element — nothing is guessed,
 * no coordinate fallback.
 *
 * The target Maestro YAML is regenerated via the same export path the
 * converter uses. Loading pairs are NOT re-emitted on copy: they are
 * recording-time knowledge, not stored in the canonical JSON.
 *
 * Manual copy also works: in the working directory, copy the test
 * file (`cp <from>/testcases/<testId>.json
 * <to>/testcases/<newTestId>.json`), then run
 * `orbit convert --test <newTestId> --platform <to>` to regenerate
 * the YAML; the converter fails loudly on unmapped elements, same as
 * this command.
 *
 * A copied test is marked "copied, unverified" until its first green
 * run on the target platform.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConversionError } from '../domain/errors.js';
import { buildMaestroFlow, elementSelectorMap, renderFlowYaml } from './maestro-export.js';
import { parseTestCase } from '../domain/testcase-schemas.js';
import type { TestCase, TestCaseStep } from '../domain/testcase-schemas.js';
import type { ElementId, LearnedScreenElement, Platform, StableSelector, TestId } from '../domain/types.js';
import { toElementId } from '../domain/types.js';
import { getPlatformDir, readFileText, writeFileAtomic } from '../infrastructure/filesystem.js';
import type { ScreenData } from '../infrastructure/variant-store.js';
import { VariantStore } from '../infrastructure/variant-store.js';

/** Inputs to one copy. */
export interface CopyTestInput {
  projectRoot: string;
  fromPlatform: Platform;
  toPlatform: Platform;
  testId: TestId;
  /** New id on the target platform; defaults to the source id. */
  newTestId?: TestId;
}

/** Outcome of one copy. */
export interface CopyTestResult {
  testCase: TestCase;
  yamlText: string;
  testCasePath: string;
  yamlPath: string;
  envExamplePath: string;
  envVars: readonly string[];
}

/** Element-id slug stem + sibling index (B3 `#n`, default 1). */
function idStemAndIndex(elementId: ElementId): { stem: string; index: number } {
  const afterScreen = elementId.includes('.') ? (elementId.split('.').slice(1).join('-') as string) : elementId;
  const indexMatch = /#(\d+)$/.exec(afterScreen);
  const index = indexMatch?.[1] !== undefined ? Number(indexMatch[1]) : 1;
  const stem = afterScreen.replace(/[#@].*$/, '');
  return { stem, index };
}

/** Rule 1: unique target element matching the source stable selector. */
function matchByStableSelector(
  source: StableSelector,
  targets: readonly LearnedScreenElement[],
): LearnedScreenElement | null {
  const matches = targets.filter((element) => {
    let compared = 0;
    for (const field of ['resourceId', 'contentDesc', 'className'] as const) {
      const expected = source[field];
      if (expected === undefined) continue;
      const actual = element.selector[field];
      if (actual === undefined) continue;
      if (actual !== expected) return false;
      compared += 1;
    }
    // A match needs at least one compared field: when the target
    // platform carries none of the source fields, everything would
    // "match" vacuously, and that is not a match.
    return compared > 0;
  });
  if (matches.length !== 1) return null;
  const match = matches[0];
  return match === undefined ? null : match;
}

/** Rule 2: unique target element with the same contentDesc. */
function matchByContentDesc(
  contentDesc: string,
  targets: readonly LearnedScreenElement[],
): LearnedScreenElement | null {
  const matches = targets.filter((element) => element.selector.contentDesc === contentDesc);
  if (matches.length !== 1) return null;
  const match = matches[0];
  return match === undefined ? null : match;
}

/** Rule 3: className + B3 sibling index, on the same id stem. */
function matchByClassAndIndex(
  sourceId: ElementId,
  source: StableSelector,
  targets: readonly LearnedScreenElement[],
): LearnedScreenElement | null {
  if (source.className === undefined) return null;
  const { stem, index } = idStemAndIndex(sourceId);
  const matches = targets.filter((element) => {
    if (element.selector.className !== source.className) return false;
    const target = idStemAndIndex(element.id);
    return target.stem === stem && target.index === index;
  });
  if (matches.length !== 1) return null;
  const match = matches[0];
  return match === undefined ? null : match;
}

/**
 * Re-resolve one element id against the target platform's screens.
 *
 * @param sourceId - Source element id.
 * @param sourceSelector - Source stable selector.
 * @param targets - Target screen's base elements.
 * @param stepIndex - Step index, named on failure.
 * @returns The target element id.
 * @throws ConversionError naming the step and element on no match.
 */
function resolveTargetElement(
  sourceId: ElementId,
  sourceSelector: StableSelector,
  targets: readonly LearnedScreenElement[],
  stepIndex: number,
): ElementId {
  const bySelector = matchByStableSelector(sourceSelector, targets);
  if (bySelector !== null) return bySelector.id;
  if (sourceSelector.contentDesc !== undefined) {
    const byDesc = matchByContentDesc(sourceSelector.contentDesc, targets);
    if (byDesc !== null) return byDesc.id;
  }
  const byClass = matchByClassAndIndex(sourceId, sourceSelector, targets);
  if (byClass !== null) return byClass.id;
  throw new ConversionError(
    `Copy failed at step ${stepIndex}: element "${sourceId}" cannot be mapped to the target platform (no stable-selector, contentDesc, or className + sibling-index match).`,
    'Learn the missing element on the target platform with orbit learn, then re-run the copy.',
    { step: String(stepIndex), elementId: sourceId },
  );
}

/** Env-var names referenced by a test case's `type` steps. */
function envVarsOf(steps: readonly TestCaseStep[]): string[] {
  const vars: string[] = [];
  for (const step of steps) {
    if (step.text === undefined) continue;
    const match = /^\$\{([A-Z0-9_]+)\}$/.exec(step.text);
    if (match?.[1] !== undefined) vars.push(match[1]);
  }
  return [...new Set(vars)];
}

/** Copy one test case across platform folders. */
export class CopyTestUseCase {
  /**
   * Copy a test case, re-resolving every element id.
   *
   * @param input - Project, platforms, test id, and optional new id.
   * @returns The copied test case, YAML, paths, and env vars.
   * @throws ConversionError naming the step and element on any unmapped element.
   */
  copy(input: CopyTestInput): CopyTestResult {
    const fromStore = new VariantStore(input.projectRoot, input.fromPlatform);
    const toStore = new VariantStore(input.projectRoot, input.toPlatform);
    const fromDir = getPlatformDir(input.projectRoot, input.fromPlatform);
    const sourcePath = path.join(fromDir, 'testcases', `${input.testId}.json`);
    if (!fs.existsSync(sourcePath)) {
      throw new ConversionError(
        `No test case "${input.testId}" on platform "${input.fromPlatform}" (${sourcePath}).`,
        `Generate it first: orbit convert --test ${input.testId} --platform ${input.fromPlatform}`,
        { testId: input.testId, platform: input.fromPlatform },
      );
    }
    const source = parseTestCase(JSON.parse(readFileText(sourcePath)) as unknown, sourcePath);
    const sourceScreens = fromStore.loadAllScreens();
    const targetScreens = toStore.loadAllScreens();
    const sourceMap = elementSelectorMap(sourceScreens);
    const targetMap = elementSelectorMap(targetScreens);
    const targetByScreen = new Map(targetScreens.map((screen) => [screen.screenId, screen]));
    const mappedSteps = source.steps.map((step) => this.mapStep(step, sourceMap, targetByScreen));
    const newTestId = input.newTestId ?? input.testId;
    const testCase: TestCase = parseTestCase(
      {
        ...source,
        id: newTestId,
        steps: mappedSteps,
        provenance: { ...source.provenance, copiedFrom: { platform: input.fromPlatform, testId: input.testId } },
        verificationStatus: 'copied-unverified',
      },
      `${newTestId}.json`,
    );
    const appId = this.resolveAppId(input, targetScreens);
    const flow = buildMaestroFlow(testCase, targetScreens, (elementId) => {
      const selector = targetMap.get(elementId);
      if (selector === undefined) {
        throw new ConversionError(
          `Element "${elementId}" has no learned selector on platform "${input.toPlatform}".`,
          'Learn the screen first with orbit learn.',
          { elementId },
        );
      }
      return selector;
    }, { appId });
    const yamlText = renderFlowYaml(flow, {
      sourceHash: createHash('sha256').update(JSON.stringify(testCase), 'utf8').digest('hex'),
      generatedAt: new Date().toISOString(),
      schemaVersion: 2,
    });
    return this.writeOutputs(input, newTestId, testCase, yamlText);
  }

  /** Map one step's element id (and assert target id) to the target platform. */
  private mapStep(
    step: TestCaseStep,
    sourceMap: ReadonlyMap<ElementId, StableSelector>,
    targetByScreen: ReadonlyMap<string, ScreenData>,
  ): TestCaseStep {
    if (step.elementId === undefined) return step;
    const sourceId = toElementId(step.elementId);
    const sourceSelector = sourceMap.get(sourceId);
    if (sourceSelector === undefined) {
      throw new ConversionError(
        `Copy failed at step ${step.index}: element "${sourceId}" has no learned selector on the source platform.`,
        'Learn the screen first with orbit learn.',
        { step: String(step.index), elementId: sourceId },
      );
    }
    const targetScreen = targetByScreen.get(step.screen);
    if (targetScreen === undefined) {
      throw new ConversionError(
        `Copy failed at step ${step.index}: screen "${step.screen}" is not learned on the target platform.`,
        'Learn the screen on the target platform with orbit learn, then re-run the copy.',
        { step: String(step.index), screenId: step.screen },
      );
    }
    const targetId = resolveTargetElement(sourceId, sourceSelector, targetScreen.baseElements, step.index);
    const mapped: TestCaseStep = { ...step, elementId: targetId };
    if (step.assert.kind === 'visible' || step.assert.kind === 'not_visible') {
      if ('id' in step.assert.target) {
        const assertTargetId = toElementId(step.assert.target.id);
        const assertSelector = sourceMap.get(assertTargetId);
        if (assertSelector !== undefined) {
          const mappedTarget = resolveTargetElement(assertTargetId, assertSelector, targetScreen.baseElements, step.index);
          mapped.assert = { kind: step.assert.kind, target: { id: mappedTarget } };
        }
      }
    }
    return mapped;
  }

  /** The `appId` for the target flow: first learned screen's package. */
  private resolveAppId(input: CopyTestInput, targetScreens: readonly ScreenData[]): string {
    for (const screen of targetScreens) {
      const screenFile = path.join(
        getPlatformDir(input.projectRoot, input.toPlatform),
        'screens',
        screen.screenId,
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
      `Cannot copy: no appId is known for platform "${input.toPlatform}".`,
      'Learn the target screens so screen.json carries an appPackage.',
      { testId: input.testId, platform: input.toPlatform },
    );
  }

  /** Write the copied JSON test case, YAML, and env manifest. */
  private writeOutputs(
    input: CopyTestInput,
    newTestId: TestId,
    testCase: TestCase,
    yamlText: string,
  ): CopyTestResult {
    const platformDir = getPlatformDir(input.projectRoot, input.toPlatform);
    const testCasePath = path.join(platformDir, 'testcases', `${newTestId}.json`);
    const yamlPath = path.join(platformDir, 'tests', `${newTestId}.yaml`);
    const envExamplePath = path.join(platformDir, 'testcases', `${newTestId}.env.example`);
    const envVars = envVarsOf(testCase.steps);
    writeFileAtomic(testCasePath, `${JSON.stringify(testCase, null, 2)}\n`);
    writeFileAtomic(yamlPath, yamlText);
    const envExample = [
      `# TestOrbit env manifest for ${newTestId} — names only, no values.`,
      `# Copied from ${input.fromPlatform}/${input.testId}; load from the environment at test setup.`,
      ...envVars.map((name) => `${name}=`),
    ].join('\n');
    writeFileAtomic(envExamplePath, `${envExample}\n`);
    return { testCase, yamlText, testCasePath, yamlPath, envExamplePath, envVars };
  }
}
