/**
 * The ONE shared recording reader (Part B, B8) — used by the converter
 * (Phase 4) and, later, the map generator (Phase 6), so the two readers
 * cannot drift.
 *
 * Accepts v1 + v2, rejects v3+ explicitly (the rejection lives here,
 * not in `recorder.ts`, which never reads recordings back). v1
 * recordings yield no edges and are labelled "unproven / start-stop
 * only". Paths resolve platform-wise first
 * (`<platform>/recordings/<flowId>.json`); the legacy flat path
 * (`.testorbit/recordings/`) is still accepted so
 * pre-TestOrbit recordings keep replaying.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TestOrbitError } from '../domain/errors.js';
import { parseRecording } from '../domain/recording-schemas.js';
import type { TestOrbitRecordingDocument } from '../domain/recording-schemas.js';
import type { Platform } from '../domain/types.js';
import { getPlatformDir } from './filesystem.js';

/** What the shared reader returns for one recording file. */
export interface RecordingReadResult {
  document: TestOrbitRecordingDocument;
  /** Schema version of the file as read (1 or 2). */
  version: 1 | 2;
  /** Edge label: v1 yields no edges ("unproven / start-stop only"). */
  edgeNote: string;
}

/** Edge note for a v1 recording: no screen/variant/element ids, no edges. */
export const V1_EDGE_NOTE =
  'unproven / start-stop only — v1 recordings carry no screenId/variantId/elementId, so no screen-map edges can be derived from them.';
/** Edge note for a v2 recording: edges are derivable where ids are present. */
export const V2_EDGE_NOTE =
  'edges derivable where actions carry screenId, variantId, and elementId.';

/** Build the read result for a parsed document. */
function toReadResult(document: TestOrbitRecordingDocument): RecordingReadResult {
  if (document.schemaVersion === 1) {
    return { document, version: 1, edgeNote: V1_EDGE_NOTE };
  }
  return { document, version: 2, edgeNote: V2_EDGE_NOTE };
}

/**
 * Read and parse one recording file by absolute path.
 *
 * @param filePath - Absolute path of the recording JSON file.
 * @returns The parsed document, its version, and its edge note.
 * @throws TestOrbitError when the file cannot be read or parsed.
 */
export function readRecordingFile(filePath: string): RecordingReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Could not read recording file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      'Check the recording id and project path.',
      { filePath },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Could not parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the file by hand or re-record the flow.',
      { filePath },
    );
  }
  return toReadResult(parseRecording(value, filePath));
}

/**
 * Resolve one recording's path: platform-wise first, legacy flat second.
 *
 * @param projectRoot - Project root (absolute).
 * @param platform - Target platform.
 * @param flowId - Recording id (file name without `.json`).
 * @returns The absolute path of the existing recording file.
 * @throws TestOrbitError when no recording file exists at either path.
 */
export function resolveRecordingPath(projectRoot: string, platform: Platform, flowId: string): string {
  const platformPath = path.join(getPlatformDir(projectRoot, platform), 'recordings', `${flowId}.json`);
  if (fs.existsSync(platformPath)) return platformPath;
  const flatPath = path.join(projectRoot, '.testorbit', 'recordings', `${flowId}.json`);
  if (fs.existsSync(flatPath)) return flatPath;
  throw new TestOrbitError(
    'FILE_READ_FAILED',
    `No recording "${flowId}" found at ${platformPath} or ${flatPath}.`,
    'Record the flow first, or check the flow id and platform.',
    { flowId, platform },
  );
}

/**
 * Read one recording by id, resolving its path with `resolveRecordingPath`.
 *
 * @param projectRoot - Project root (absolute).
 * @param platform - Target platform.
 * @param flowId - Recording id.
 * @returns The parsed document, its version, and its edge note.
 */
export function readRecording(projectRoot: string, platform: Platform, flowId: string): RecordingReadResult {
  return readRecordingFile(resolveRecordingPath(projectRoot, platform, flowId));
}
