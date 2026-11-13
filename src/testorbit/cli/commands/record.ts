/**
 * `orbit record --dry-run` (Phase 4, Decision 3) — prints the plan
 * without touching the device.
 *
 * Dry-run is the DEFAULT: `orbit record` prints the ordered steps
 * that WOULD be recorded, with the resolved `(screen, variant,
 * elementId)` per step, and writes nothing. Input is the agent's
 * planned steps as JSON (a `RecordingDocument` or a bare `{ actions }`
 * object), passed via `--plan-file`.
 *
 * Scope (honest): the flag exists on the `orbit record` CLI only.
 * Live recording happens through the MCP recording path
 * (`orbit_start_recording` + the UI tools); `--no-dry-run` prints the plan
 * and says so instead of touching a device — the CLI has no
 * device-recording path of its own.
 */
import fs from 'node:fs';
import { annotateRecording } from '../../application/annotate-recording.js';
import { parseRecording } from '../../domain/recording-schemas.js';
import type { TestOrbitRecordingDocument } from '../../domain/recording-schemas.js';
import { TestOrbitError } from '../../domain/errors.js';
import { isPlatform } from '../../domain/types.js';
import type { Platform } from '../../domain/types.js';
import { VariantStore } from '../../infrastructure/variant-store.js';

/** Inputs to `orbit record`. */
export interface RecordCommandOptions {
  projectRoot: string;
  platform: Platform;
  /** Planned-steps JSON file (`RecordingDocument` or `{ actions }`). */
  planFile: string;
  /** False only with `--no-dry-run`; dry-run is the default. */
  dryRun?: boolean;
  /** Output sink (defaults to stdout); injectable for tests. */
  write?: (text: string) => void;
}

/** Normalise a plan file into a recording document (defaults filled). */
function readPlanFile(planFile: string): TestOrbitRecordingDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(planFile, 'utf8')) as unknown;
  } catch (error) {
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Could not read plan file ${planFile}: ${error instanceof Error ? error.message : String(error)}`,
      'Pass --plan-file <path> with planned steps as JSON.',
      { filePath: planFile },
    );
  }
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    return parseRecording(raw, planFile);
  }
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { actions?: unknown }).actions)) {
    const actions = (raw as { actions: Record<string, unknown>[] }).actions;
    return parseRecording(
      {
        schemaVersion: 1,
        flowId: 'dry-run-plan',
        deviceId: 'dry-run',
        startedAt: new Date().toISOString(),
        stoppedAt: new Date().toISOString(),
        durationMs: 0,
        actions: actions.map((action, position) => ({
          id: `plan-${position + 1}`,
          type: 'tap',
          timestamp: new Date().toISOString(),
          durationMs: 0,
          ...action,
        })),
        screenshots: {},
      },
      planFile,
    );
  }
  throw new TestOrbitError(
    'INVALID_ARGUMENT',
    `Plan file ${planFile} must hold a RecordingDocument or a bare { actions } object.`,
    'Write the planned steps as JSON in one of those two shapes.',
    { filePath: planFile },
  );
}

/**
 * Run `orbit record` (dry-run by default).
 *
 * @param options - Project, platform, plan file, and dry-run flag.
 * @returns 0 when the plan resolves (or when `--no-dry-run` notes the MCP path).
 * @throws TestOrbitError when a planned step cannot be resolved.
 */
export async function runRecordCommand(options: RecordCommandOptions): Promise<number> {
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
  const dryRun = options.dryRun ?? true;
  const recording = readPlanFile(options.planFile);
  const store = new VariantStore(options.projectRoot, options.platform);
  const annotated = annotateRecording(recording, store.loadAllScreens());
  const lines = annotated.map(
    (item, position) =>
      `${position + 1}. would execute ${item.action.type} on ${item.screenId} / ${item.variantId} / ${item.elementId ?? '(no element)'}`,
  );
  if (dryRun) {
    write(`${lines.join('\n')}\n(dry-run: nothing was recorded, nothing was written)\n`);
    return 0;
  }
  write(
    `${lines.join('\n')}\n(live recording runs through the MCP tools: orbit_start_recording + the UI tools. The CLI previews only and touches no device.)\n`,
  );
  return 0;
}
