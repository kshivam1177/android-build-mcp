/**
 * `orbit check` (Phase 6, C3/C16) — run `check-screen-map` and print
 * the report. Thin wrapper around `CheckMapUseCase`. Returns 1 when
 * the report has any `fail` finding; warnings never fail the check.
 * Output goes through `process.stdout.write`.
 */
import { CheckMapUseCase } from '../../application/check-map.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform } from '../../domain/types.js';
import type { Platform } from '../../domain/types.js';

/** Inputs to `orbit check`. */
export interface CheckCommandOptions {
  projectRoot: string;
  platform: Platform;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Run `orbit check`.
 *
 * @param options - Project and platform.
 * @returns 0 when the check passes, 1 when any rule fails.
 */
export async function runCheckCommand(options: CheckCommandOptions): Promise<number> {
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
  const { report } = new CheckMapUseCase().check({
    projectRoot: options.projectRoot,
    platform: options.platform,
  });
  write(`${JSON.stringify(report, null, 2)}\n`);
  return report.passed ? 0 : 1;
}
