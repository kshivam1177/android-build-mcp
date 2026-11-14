/**
 * `orbit rename-screen` (Phase 6, D11) — rename a screen id and
 * rewrite every reference to it. Thin wrapper around
 * `RenameScreenUseCase`. Output goes through `process.stdout.write`.
 */
import { RenameScreenUseCase } from '../../application/rename-screen.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform, toScreenId } from '../../domain/types.js';
import type { Platform, ScreenId } from '../../domain/types.js';

/** Inputs to `orbit rename-screen`. */
export interface RenameScreenCommandOptions {
  projectRoot: string;
  platform: Platform;
  fromScreenId: ScreenId;
  toScreenId: ScreenId;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Run `orbit rename-screen`.
 *
 * @param options - Project, platform, old and new screen ids.
 * @returns 0 when the rename succeeds.
 * @throws TestOrbitError when the old screen does not exist, the new id
 *   is taken, or a reference cannot be rewritten.
 */
export async function runRenameScreenCommand(options: RenameScreenCommandOptions): Promise<number> {
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
  const result = new RenameScreenUseCase().rename({
    projectRoot: options.projectRoot,
    platform: options.platform,
    fromScreenId: options.fromScreenId,
    toScreenId: options.toScreenId,
  });
  write(
    `${JSON.stringify(
      {
        from: result.fromScreenId,
        to: result.toScreenId,
        backupPath: result.backupPath,
        rewrittenFiles: [...result.rewrittenFiles],
        mapPath: result.mapPath,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

/** Brand an old screen id string from CLI arguments. */
export function renameFromScreenIdFromCli(value: string): ScreenId {
  return toScreenId(value);
}

/** Brand a new screen id string from CLI arguments. */
export function renameToScreenIdFromCli(value: string): ScreenId {
  return toScreenId(value);
}
