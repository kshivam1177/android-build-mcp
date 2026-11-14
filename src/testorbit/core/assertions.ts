/**
 * Pure converter helpers (Phase 4, C2) — the assertion-emission rule,
 * the env-var naming rule, swipe direction, and key mapping.
 *
 * Assertion emission rule: one `assertVisible` per step, on the first
 * `required` element of the target variant that is unique to that
 * variant (present in that variant's `required` set and in no other
 * variant's `required` set of the same screen); if no such element
 * exists, on all `required` elements of the target variant.
 *
 * Env-var naming: every typed value maps to
 * `${TEST_<SCREEN>_<ELEMENT_SLUG>}` (e.g. typing the password on
 * `login.password` → `${TEST_LOGIN_PASSWORD}`). Pure logic, no I/O.
 */
import type { ElementId } from '../domain/types.js';

/** First required element unique to this variant, or null when none is. */
export function uniqueRequiredElement(
  required: readonly ElementId[],
  siblingRequiredSets: readonly (readonly ElementId[])[],
): ElementId | null {
  const siblingIds = new Set(siblingRequiredSets.flat());
  for (const id of required) {
    if (!siblingIds.has(id)) return id;
  }
  return null;
}

/**
 * Element ids to assert for one variant (the emission rule).
 *
 * @param required - The target variant's required element ids.
 * @param siblingRequiredSets - Required sets of the screen's other variants.
 * @returns The unique required element, or all required elements.
 */
export function assertionElementIds(
  required: readonly ElementId[],
  siblingRequiredSets: readonly (readonly ElementId[])[],
): readonly ElementId[] {
  const unique = uniqueRequiredElement(required, siblingRequiredSets);
  if (unique !== null) return [unique];
  return [...required];
}

/**
 * Env-var name for a typed value on one element (C2 naming rule).
 *
 * @param screenId - Screen id, e.g. `login`.
 * @param elementId - Element id, e.g. `login.password` or `checkout.card-number#1`.
 * @returns The env-var name, e.g. `TEST_LOGIN_PASSWORD`.
 */
export function envVarFor(screenId: string, elementId: string): string {
  const slug = elementId.includes('.') ? (elementId.split('.').slice(1).join('-') as string) : elementId;
  const clean = slug.replace(/[#@].*$/, '');
  const upper = `${screenId}_${clean}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `TEST_${upper}`;
}

/**
 * Maestro swipe direction from a recorded swipe's start/end points.
 *
 * @param start - Swipe start point.
 * @param end - Swipe end point.
 * @returns The dominant-axis direction (UP/DOWN/LEFT/RIGHT).
 */
export function swipeDirection(
  start: { x: number; y: number },
  end: { x: number; y: number },
): 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'RIGHT' : 'LEFT';
  return dy >= 0 ? 'DOWN' : 'UP';
}

/**
 * Maestro `pressKey` name for a recorded Android key code.
 *
 * @param keyCode - Recorded key code, e.g. `KEYCODE_BACK` or `BACK`.
 * @returns The Maestro key name (the `KEYCODE_` prefix stripped).
 */
export function maestroKeyName(keyCode: string): string {
  return keyCode.replace(/^KEYCODE_/, '').toUpperCase();
}
