/**
 * `orbit copy` (Part C, C4) — copy a test across platform folders,
 * re-resolving each step's element id against the target platform's
 * learned screens. Thin wrapper around `CopyTestUseCase`. Output goes
 * through `process.stdout.write`.
 */
import { CopyTestUseCase } from '../../application/copy-test.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform, toTestId } from '../../domain/types.js';
import type { Platform, TestId } from '../../domain/types.js';

/** Inputs to `orbit copy`. */
export interface CopyCommandOptions {
  projectRoot: string;
  fromPlatform: Platform;
  toPlatform: Platform;
  testId: TestId;
  /** New id on the target platform; defaults to the source id. */
  newTestId?: TestId;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Run `orbit copy`.
 *
 * @param options - Project, platforms, test id, optional new id.
 * @returns 0 when the copy succeeds.
 * @throws TestOrbitError when an element cannot be mapped on the target platform.
 */
export async function runCopyCommand(options: CopyCommandOptions): Promise<number> {
  if (!isPlatform(options.fromPlatform) || !isPlatform(options.toPlatform)) {
    throw new TestOrbitError(
      'INVALID_PLATFORM',
      `Unsupported platform "${options.fromPlatform}" or "${options.toPlatform}".`,
      'Pass one of android, ios, flutter, web for --from and --to.',
      { from: options.fromPlatform, to: options.toPlatform },
    );
  }
  const write = options.write ?? ((text: string): void => {
    process.stdout.write(text);
  });
  const result = new CopyTestUseCase().copy({
    projectRoot: options.projectRoot,
    fromPlatform: options.fromPlatform,
    toPlatform: options.toPlatform,
    testId: options.testId,
    ...(options.newTestId !== undefined ? { newTestId: options.newTestId } : {}),
  });
  write(
    `${JSON.stringify(
      {
        testId: result.testCase.id,
        from: options.fromPlatform,
        to: options.toPlatform,
        verificationStatus: result.testCase.verificationStatus,
        testCasePath: result.testCasePath,
        yamlPath: result.yamlPath,
        envVars: [...result.envVars],
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

/** Brand a test id string from CLI arguments. */
export function copyTestIdFromCli(value: string): TestId {
  return toTestId(value);
}
