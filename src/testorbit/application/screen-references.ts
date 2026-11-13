/**
 * Screen-reference rewriting (Phase 6, D11) — the pure string/JSON
 * helpers `rename-screen` uses to relabel every reference to a
 * screen id.
 *
 * One id string is rewritten when it is exactly the old screen id,
 * or starts with `<old>.` (element ids, variant ids). Env-var names
 * use the `TEST_<SCREEN>_` prefix. Variant files get a fresh
 * `fingerprintStamp` after relabelling — the stamp hashes the
 * screen/variant ids and the element sets, so the old stamp would
 * fail `check-screen-map` after any rename.
 *
 * What is NOT rewritten here: the app's real `appRoute`, recording
 * `flowId`s, test ids, and resourceIds/contentDescs.
 */
import { computeVariantFingerprintStamp } from '../core/fingerprint.js';
import { toElementId } from '../domain/types.js';

/** One planned file rewrite: original path, new contents, optional new path. */
export interface PlannedRewrite {
  filePath: string;
  contents: string;
  renameTo?: string;
}

/** SCREAMING_SNAKE form of a screen id, as used in env-var names. */
export function screaming(screenId: string): string {
  return screenId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Rewrite one id string: exact screen id, or `<screen>.<rest>` prefix. */
export function relabelId(value: string, from: string, to: string): string {
  if (value === from) return to;
  if (value.startsWith(`${from}.`)) return `${to}.${value.slice(from.length + 1)}`;
  return value;
}

/** Rewrite the `TEST_<SCREEN>_` env-var prefix inside one string. */
export function relabelEnvVars(value: string, fromUpper: string, toUpper: string): string {
  return value.split(`TEST_${fromUpper}_`).join(`TEST_${toUpper}_`);
}

/** Rewrite every id/env-var string inside a parsed JSON value. */
export function deepRewrite(
  value: unknown,
  from: string,
  to: string,
  fromUpper: string,
  toUpper: string,
): unknown {
  if (typeof value === 'string') return relabelEnvVars(relabelId(value, from, to), fromUpper, toUpper);
  if (Array.isArray(value)) {
    return value.map((item) => deepRewrite(item, from, to, fromUpper, toUpper));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = deepRewrite(item, from, to, fromUpper, toUpper);
    }
    return out;
  }
  return value;
}

/** True when the value is an array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Recompute a variant file's fingerprint stamp after its ids were relabelled.
 *
 * @param rewrite - Planned rewrite of a variant file (or any JSON file).
 * @returns The rewrite with a fresh stamp, or unchanged when the file
 *   is not a variant file.
 */
export function refreshVariantStamp(rewrite: PlannedRewrite): PlannedRewrite {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rewrite.contents) as unknown;
  } catch {
    return rewrite;
  }
  if (typeof parsed !== 'object' || parsed === null) return rewrite;
  const record = parsed as Record<string, unknown>;
  if (record['schemaVersion'] !== 2 || typeof record['screenId'] !== 'string') return rewrite;
  if (typeof record['variantId'] !== 'string') return rewrite;
  if (!isStringArray(record['required']) || !isStringArray(record['optional'])) return rewrite;
  if (!isStringArray(record['excluded'])) return rewrite;
  const stamped = {
    ...record,
    fingerprintStamp: computeVariantFingerprintStamp({
      screenId: record['screenId'],
      variantId: record['variantId'],
      required: record['required'].map(toElementId),
      optional: record['optional'].map(toElementId),
      excluded: record['excluded'].map(toElementId),
    }),
  };
  return { ...rewrite, contents: `${JSON.stringify(stamped, null, 2)}\n` };
}
