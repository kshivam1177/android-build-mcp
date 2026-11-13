/**
 * `orbit run` (Phase 4) — thin wrapper around the TestOrbit Runner
 * (`RunTestUseCase`): pre-flow detection, `maestro test`, post-run
 * failure analysis, report. Prints the report path and exits 1 when
 * the run fails. Output goes through `process.stdout.write`.
 */
import { RunTestUseCase, testIdFromCli } from '../../application/run-test.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform } from '../../domain/types.js';
import type { Platform, TestId } from '../../domain/types.js';
import type { HierarchyProvider } from '../../infrastructure/hierarchy-provider.js';
import { VariantStore } from '../../infrastructure/variant-store.js';

/** Inputs to `orbit run`. */
export interface RunCommandOptions {
  projectRoot: string;
  platform: Platform;
  testId: TestId;
  /** Offline hierarchy dump file (`{ nodes, display }`). */
  hierarchyFile?: string;
  /** Live hierarchy source; required when no hierarchy file is given. */
  hierarchyProvider?: HierarchyProvider;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Run `orbit run`.
 *
 * @param options - Project, platform, test id, hierarchy source.
 * @returns 0 when the run passes, 1 when it fails.
 * @throws TestOrbitError when the test case or YAML is missing, or Maestro is not installed.
 */
export async function runRunCommand(options: RunCommandOptions): Promise<number> {
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
  const useCase = new RunTestUseCase(new VariantStore(options.projectRoot, options.platform));
  const result = await useCase.run({
    projectRoot: options.projectRoot,
    platform: options.platform,
    testId: options.testId,
    ...(options.hierarchyFile !== undefined ? { hierarchyFile: options.hierarchyFile } : {}),
    ...(options.hierarchyProvider !== undefined ? { hierarchyProvider: options.hierarchyProvider } : {}),
  });
  write(
    `${JSON.stringify(
      {
        testId: options.testId,
        success: result.success,
        reportPath: result.reportPath,
        failureBundlePath: result.failureBundlePath,
      },
      null,
      2,
    )}\n`,
  );
  return result.success ? 0 : 1;
}

/** Brand a test id string from CLI arguments. */
export function runTestIdFromCli(value: string): TestId {
  return testIdFromCli(value);
}
