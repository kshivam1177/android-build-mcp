/**
 * `orbit generate-map` (Phase 6, C3) — generate `<platform>/screen-map.json`
 * from the learned screens and v2 recordings. Thin wrapper around
 * `GenerateMapUseCase`. Output goes through `process.stdout.write`.
 */
import { GenerateMapUseCase } from '../../application/generate-map.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform } from '../../domain/types.js';
import type { Platform } from '../../domain/types.js';

/** Inputs to `orbit generate-map`. */
export interface GenerateMapCommandOptions {
  projectRoot: string;
  platform: Platform;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/**
 * Run `orbit generate-map`.
 *
 * @param options - Project and platform.
 * @returns 0 when the map is generated.
 * @throws TestOrbitError when a learned screen or variant file is invalid.
 */
export async function runGenerateMapCommand(options: GenerateMapCommandOptions): Promise<number> {
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
  const result = new GenerateMapUseCase().generate({
    projectRoot: options.projectRoot,
    platform: options.platform,
  });
  write(
    `${JSON.stringify(
      {
        mapPath: result.mapPath,
        screens: result.map.coverage.screensLearned,
        variants: result.map.coverage.variantsLearned,
        edges: result.map.coverage.edgeCount,
        screensNeverTraversed: [...result.map.coverage.screensNeverTraversed],
        variantsNeverTraversed: [...result.map.coverage.variantsNeverTraversed],
        recordingsRead: result.recordingsRead,
        recordingsSkipped: result.recordingsSkipped,
        warnings: [...result.warnings],
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}
