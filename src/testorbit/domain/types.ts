/**
 * TestOrbit domain types — the contract every layer shares.
 *
 * Ids are branded strings so a plain string can never be passed where an
 * ElementId, ScreenId, VariantId, or TestId is required; the compiler
 * catches the confusion. Branding happens only at the validated boundaries
 * in this file (the `to*` factories) and at the Zod parse boundary in
 * `schemas.ts` (Phase 2).
 */
import { z } from 'zod';
import { TestOrbitError } from './errors.js';

/** A branded string: the type parameter is the brand, never a value. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Logical screen id, e.g. `checkout`. */
export type ScreenId = Brand<string, 'ScreenId'>;
/** Variant of a logical screen, e.g. `checkout.online-card`. */
export type VariantId = Brand<string, 'VariantId'>;
/** Stable element id, e.g. `checkout.pay-now` (see B3). */
export type ElementId = Brand<string, 'ElementId'>;
/** Saved test case id, e.g. `checkout-cod`. */
export type TestId = Brand<string, 'TestId'>;

/** Platforms TestOrbit supports (Part A): Android, iOS, Flutter, web. */
export const PlatformSchema = z.enum(['android', 'ios', 'flutter', 'web']);
export type Platform = z.infer<typeof PlatformSchema>;
export const PLATFORMS: readonly Platform[] = PlatformSchema.options;

/**
 * Narrow a runtime string to a Platform.
 *
 * @param value - Candidate value.
 * @returns True when the value is one of the supported platforms.
 */
export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/** Bounds of one hierarchy node, in absolute display pixels. */
export interface NodeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The stable-selector fields (B5): never text, never bounds, never coordinates. */
export interface StableSelector {
  resourceId?: string;
  contentDesc?: string;
  className?: string;
}

/**
 * Minimal structural view of a hierarchy node that TestOrbit core logic needs
 * for identity (B3). The full `UiNode` (src/types.ts) satisfies this
 * interface; core never imports the repo-wide type.
 */
export interface IdentityNode {
  ref: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  /** Ref of the immediate parent node, absent for hierarchy roots. */
  parentRef?: string;
  /** Ancestor refs from the hierarchy root down to the immediate parent. */
  ancestorChain?: readonly string[];
}

/** Identity view plus the runtime state core matching needs (B4/B6). */
export interface CoreHierarchyNode extends IdentityNode {
  text?: string;
  packageName?: string;
  bounds: NodeBounds;
  clickable: boolean;
  enabled: boolean;
  focusable?: boolean;
  checkable?: boolean;
}

/** A learned screen element as stored in `elements.json` (B2/B5). */
export interface LearnedScreenElement {
  id: ElementId;
  selector: StableSelector;
  clickable: boolean;
  enabled: boolean;
  text?: string;
  bounds?: NodeBounds;
}

/** One variant definition as stored in `screens/<screenId>/variants/<variantId>.json` (B2). */
export interface VariantDefinition {
  schemaVersion: 2;
  screenId: ScreenId;
  variantId: VariantId;
  required: readonly ElementId[];
  optional: readonly ElementId[];
  excluded: readonly ElementId[];
  /** `sha256:<hex>` of the canonical content excluding this field (B2). */
  fingerprintStamp: string;
  learnedAt: string;
  learnedFrom?: string;
}

const SCREEN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const ELEMENT_ID_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.[a-z0-9][a-z0-9-]*(@[a-z0-9][a-z0-9-]*)?(#[0-9]+)?$/;
const APP_ROUTE_PATTERN = /^\/[a-z0-9/_-]*$/;

/**
 * Brand a validated string as a ScreenId.
 *
 * @param value - Candidate screen id.
 * @returns The branded ScreenId.
 * @throws TestOrbitError when the value is not a valid screen id.
 */
export function toScreenId(value: string): ScreenId {
  if (!SCREEN_ID_PATTERN.test(value)) {
    throw new TestOrbitError(
      'INVALID_ID',
      `Invalid screen id "${value}": must be 1-80 characters of letters, numbers, dot, underscore, or hyphen.`,
      'Use a kebab-case screen id such as "checkout".',
      { field: 'screenId', value },
    );
  }
  return value as ScreenId;
}

/**
 * Brand a validated string as a VariantId.
 *
 * @param value - Candidate variant id.
 * @returns The branded VariantId.
 * @throws TestOrbitError when the value is not a valid variant id.
 */
export function toVariantId(value: string): VariantId {
  if (!SCREEN_ID_PATTERN.test(value)) {
    throw new TestOrbitError(
      'INVALID_ID',
      `Invalid variant id "${value}": must be 1-80 characters of letters, numbers, dot, underscore, or hyphen.`,
      'Use a kebab-case variant id such as "checkout.online-card".',
      { field: 'variantId', value },
    );
  }
  return value as VariantId;
}

/**
 * Brand a validated string as an ElementId.
 *
 * @param value - Candidate element id.
 * @returns The branded ElementId.
 * @throws TestOrbitError when the value is not a valid element id.
 */
export function toElementId(value: string): ElementId {
  if (!ELEMENT_ID_PATTERN.test(value)) {
    throw new TestOrbitError(
      'INVALID_ID',
      `Invalid element id "${value}": expected "<screen>.<kebab-slug>" with optional "@<ancestor>" and "#<n>" suffixes.`,
      'Derive element ids with deriveElementId instead of building them by hand.',
      { field: 'elementId', value },
    );
  }
  return value as ElementId;
}

/**
 * Brand a validated string as a TestId.
 *
 * @param value - Candidate test id.
 * @returns The branded TestId.
 * @throws TestOrbitError when the value is not a valid test id.
 */
export function toTestId(value: string): TestId {
  if (!SCREEN_ID_PATTERN.test(value)) {
    throw new TestOrbitError(
      'INVALID_ID',
      `Invalid test id "${value}": must be 1-80 characters of letters, numbers, dot, underscore, or hyphen.`,
      'Use a kebab-case test id such as "checkout-cod".',
      { field: 'testId', value },
    );
  }
  return value as TestId;
}

/**
 * Validate an appRoute at learn time (Phase 1 task 8): format only — it
 * must start with `/` and contain only `[a-z0-9/_-]`. There is no route
 * registry to check against, so "must match the app's real route pattern"
 * is unverifiable and is not claimed here. Absent means unvalidated.
 *
 * @param appRoute - The route to validate, if provided.
 * @throws TestOrbitError naming the `appRoute` field when the format is invalid.
 */
export function validateAppRoute(appRoute: string | undefined): void {
  if (appRoute === undefined) return;
  if (!APP_ROUTE_PATTERN.test(appRoute)) {
    throw new TestOrbitError(
      'INVALID_APP_ROUTE',
      `Invalid appRoute "${appRoute}": must start with "/" and contain only lowercase letters, numbers, "/", "_", or "-".`,
      'Fix the appRoute passed to orbit_learn_screen, e.g. "/checkout".',
      { field: 'appRoute', value: appRoute },
    );
  }
}
