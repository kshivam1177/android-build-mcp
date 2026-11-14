/**
 * `orbit convert` (Phase 4, C2) — recording → canonical JSON test
 * case + Maestro YAML. Thin wrapper around `ConvertRecordingUseCase`;
 * the manual-copy path (C4) calls this command after `cp`-ing a test
 * file. Output goes through `process.stdout.write`.
 */
import { ConvertRecordingUseCase, testIdFromInput } from '../../application/convert-recording.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform } from '../../domain/types.js';
import type { Platform, TestId } from '../../domain/types.js';
import { readRecording } from '../../infrastructure/recording-reader.js';
import { VariantStore } from '../../infrastructure/variant-store.js';

/** Inputs to `orbit convert`. */
export interface ConvertCommandOptions {
  projectRoot: string;
  platform: Platform;
  flowId: string;
  testId: TestId;
  /** Plain-language goal; defaults to the flow id. */
  goal?: string;
  /** Maestro app id; falls back to the learned screens' appPackage. */
  appId?: string;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Run `orbit convert`.
 *
 * @param options - Project, platform, recording id, test id.
 * @returns 0 when the conversion succeeds.
 * @throws TestOrbitError when the recording cannot be read or converted.
 */
export async function runConvertCommand(options: ConvertCommandOptions): Promise<number> {
  if (!isPlatform(options.platform)) {
    throw new TestOrbitError(
      'INVALID_PLATFORM',
      `Unsupported platform "${options.platform}".`,
      'Pass one of android, ios, flutter, web.',
      { platform: options.platform },
    );
  }
  const write = options.write ?? ((text: string): void => {
    process.stdout.write(text);
  });
  const recording = readRecording(options.projectRoot, options.platform, options.flowId);
  const useCase = new ConvertRecordingUseCase(new VariantStore(options.projectRoot, options.platform));
  const result = useCase.convert({
    projectRoot: options.projectRoot,
    platform: options.platform,
    recording: recording.document,
    testId: options.testId,
    ...(options.goal !== undefined ? { goal: options.goal } : {}),
    ...(options.appId !== undefined ? { appId: options.appId } : {}),
  });
  write(
    `${JSON.stringify(
      {
        testId: options.testId,
        steps: result.testCase.steps.length,
        testCasePath: result.testCasePath,
        yamlPath: result.yamlPath,
        envExamplePath: result.envExamplePath,
        envVars: [...result.envVars],
        submitElementId: result.submitElementId,
        warnings: [...result.warnings],
        recordingVersion: recording.version,
        edgeNote: recording.edgeNote,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

/** Brand a test id string from CLI arguments. */
export function convertTestIdFromCli(value: string): TestId {
  return testIdFromInput(value);
}
