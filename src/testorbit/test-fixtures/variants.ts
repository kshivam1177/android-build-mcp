/**
 * Variant fixtures for unit-testing pure TestOrbit logic ONLY (Part D, D6).
 *
 * Two domains prove the variant model is generic (Phase 2 task 6):
 * checkout (method picker / card / UPI / COD / combined) and login
 * (password vs OTP vs SSO). These are test data for the matcher and the
 * learner — never flows, never shipped as example tests, never a stand-in
 * for a real app.
 *
 * Excluded sets follow B7: every variant excludes the other variants'
 * elements (backfilled as later variants are learned), so the sets below
 * are the steady state after all variants of the screen are learned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeVariantFingerprintStamp } from '../core/fingerprint.js';
import type { VariantCandidate } from '../core/variant-match.js';
import { toElementId, toScreenId, toVariantId } from '../domain/types.js';
import type { CoreHierarchyNode, ElementId, LearnedScreenElement, Platform, ScreenId, VariantDefinition } from '../domain/types.js';

export const DISPLAY = { width: 1080, height: 2400 };
const ON_SCREEN = { left: 10, top: 20, right: 110, bottom: 70 };

type ElementRow = readonly [id: string, resourceId: string];

const CHECKOUT_ELEMENTS: readonly ElementRow[] = [
  ['checkout.help', 'com.shop.app:id/help'],
  ['checkout.back', 'com.shop.app:id/back'],
  ['checkout.cod-option', 'com.shop.app:id/cod_option'],
  ['checkout.card-option', 'com.shop.app:id/card_option'],
  ['checkout.upi-option', 'com.shop.app:id/upi_option'],
  ['checkout.card-number', 'com.shop.app:id/card_number'],
  ['checkout.expiry', 'com.shop.app:id/expiry'],
  ['checkout.cvv', 'com.shop.app:id/cvv'],
  ['checkout.pay', 'com.shop.app:id/pay'],
  ['checkout.save-card', 'com.shop.app:id/save_card'],
  ['checkout.upi-id', 'com.shop.app:id/upi_id'],
  ['checkout.upi-pay', 'com.shop.app:id/upi_pay'],
  ['checkout.cod-confirm', 'com.shop.app:id/cod_confirm'],
];

const LOGIN_ELEMENTS: readonly ElementRow[] = [
  ['login.help', 'com.shop.app:id/help'],
  ['login.back', 'com.shop.app:id/back'],
  ['login.username', 'com.shop.app:id/username'],
  ['login.password', 'com.shop.app:id/password'],
  ['login.submit', 'com.shop.app:id/submit'],
  ['login.otp-field', 'com.shop.app:id/otp_field'],
  ['login.verify-otp', 'com.shop.app:id/verify_otp'],
  ['login.sso-google', 'com.shop.app:id/sso_google'],
  ['login.sso-apple', 'com.shop.app:id/sso_apple'],
];

interface VariantSpec {
  variantId: string;
  required: readonly string[];
  optional?: readonly string[];
  excluded: readonly string[];
}

const CHECKOUT_VARIANTS: readonly VariantSpec[] = [
  { variantId: 'default', required: ['checkout.help'], excluded: [] },
  {
    variantId: 'checkout.method-picker',
    required: ['checkout.cod-option', 'checkout.card-option', 'checkout.upi-option'],
    excluded: ['checkout.card-number', 'checkout.expiry', 'checkout.cvv', 'checkout.pay', 'checkout.save-card', 'checkout.upi-id', 'checkout.upi-pay', 'checkout.cod-confirm'],
  },
  {
    variantId: 'checkout.online-card',
    required: ['checkout.card-number', 'checkout.expiry', 'checkout.cvv', 'checkout.pay'],
    optional: ['checkout.save-card'],
    excluded: ['checkout.upi-id', 'checkout.upi-pay', 'checkout.cod-confirm', 'checkout.cod-option', 'checkout.card-option', 'checkout.upi-option'],
  },
  {
    variantId: 'checkout.upi',
    required: ['checkout.upi-id', 'checkout.upi-pay'],
    excluded: ['checkout.card-number', 'checkout.expiry', 'checkout.cvv', 'checkout.pay', 'checkout.save-card', 'checkout.cod-confirm', 'checkout.cod-option', 'checkout.card-option', 'checkout.upi-option'],
  },
  {
    variantId: 'checkout.cod',
    required: ['checkout.cod-confirm'],
    excluded: ['checkout.card-number', 'checkout.expiry', 'checkout.cvv', 'checkout.pay', 'checkout.save-card', 'checkout.upi-id', 'checkout.upi-pay', 'checkout.cod-option', 'checkout.card-option', 'checkout.upi-option'],
  },
  {
    variantId: 'checkout.card-upi-combined',
    required: ['checkout.card-number', 'checkout.expiry', 'checkout.cvv', 'checkout.pay', 'checkout.upi-id', 'checkout.upi-pay'],
    optional: ['checkout.save-card'],
    excluded: ['checkout.cod-confirm', 'checkout.cod-option', 'checkout.card-option', 'checkout.upi-option'],
  },
];

const LOGIN_VARIANTS: readonly VariantSpec[] = [
  { variantId: 'default', required: ['login.help'], excluded: [] },
  {
    variantId: 'login.password',
    required: ['login.username', 'login.password', 'login.submit'],
    excluded: ['login.otp-field', 'login.verify-otp', 'login.sso-google', 'login.sso-apple'],
  },
  {
    variantId: 'login.otp',
    required: ['login.otp-field', 'login.verify-otp'],
    excluded: ['login.username', 'login.password', 'login.submit', 'login.sso-google', 'login.sso-apple'],
  },
  {
    variantId: 'login.sso',
    required: ['login.sso-google', 'login.sso-apple'],
    excluded: ['login.username', 'login.password', 'login.submit', 'login.otp-field', 'login.verify-otp'],
  },
];

/** Learned element (selector + state) for one fixture element row. */
function learnedElement(row: ElementRow): LearnedScreenElement {
  return { id: toElementId(row[0]), selector: { resourceId: row[1] }, clickable: true, enabled: true };
}

/** Fresh hierarchy node for one fixture element row. */
function freshNode(row: ElementRow, ref: string): CoreHierarchyNode {
  return { ref, resourceId: row[1], bounds: ON_SCREEN, clickable: true, enabled: true };
}

/** All learned elements of a screen (its base `elements.json`). */
export function baseElements(screenId: ScreenId): LearnedScreenElement[] {
  const rows = screenId === 'checkout' ? CHECKOUT_ELEMENTS : LOGIN_ELEMENTS;
  return rows.map(learnedElement);
}

/** Fresh hierarchy nodes for the given element ids of a screen. */
export function freshNodes(screenId: ScreenId, ids: readonly string[]): CoreHierarchyNode[] {
  const rows = screenId === 'checkout' ? CHECKOUT_ELEMENTS : LOGIN_ELEMENTS;
  const byId = new Map(rows.map((row) => [row[0], row]));
  return ids.map((id, index) => freshNode(byId.get(id) as ElementRow, `e${index + 1}`));
}

/**
 * Build match candidates for a whole screen at once: the learned set of
 * one variant is the screen's shared elements (in no variant's
 * required/optional sets) plus that variant's own required/optional
 * elements. An element belonging to another variant is never in this
 * variant's learned set — it is in its excluded set instead — so the B4
 * drift budget is never charged for another variant's elements being
 * absent. Excluded selectors are carried separately for clause (ii).
 */
function buildCandidates(screenId: ScreenId, specs: readonly VariantSpec[]): VariantCandidate[] {
  const base = baseElements(screenId);
  // Ownership is computed over the specific variants only: the `default`
  // variant's designated required elements are shared screen elements,
  // not owned by any variant, so they stay in every learned set.
  const owned = new Set<string>();
  for (const spec of specs) {
    if (spec.variantId === 'default') continue;
    for (const id of [...spec.required, ...(spec.optional ?? [])]) owned.add(id);
  }
  return specs.map((spec) => {
    const required = spec.required.map(toElementId);
    const optional = (spec.optional ?? []).map(toElementId);
    const excluded = spec.excluded.map(toElementId);
    const excludedSet = new Set(spec.excluded);
    const own = new Set([...spec.required, ...(spec.optional ?? [])]);
    return {
      screenId,
      variantId: toVariantId(spec.variantId),
      required,
      optional,
      excluded,
      elements: base.filter((element) => !excludedSet.has(element.id) && (!owned.has(element.id) || own.has(element.id))),
      excludedElements: base.filter((element) => excludedSet.has(element.id)),
    };
  });
}

/** Match candidates for every checkout variant (default included). */
export function checkoutCandidates(): VariantCandidate[] {
  return buildCandidates(toScreenId('checkout'), CHECKOUT_VARIANTS);
}

/** Match candidates for every login variant (default included). */
export function loginCandidates(): VariantCandidate[] {
  return buildCandidates(toScreenId('login'), LOGIN_VARIANTS);
}

/** Checkout candidates without the combined variant file (B2 negative case). */
export function checkoutCandidatesWithoutCombined(): VariantCandidate[] {
  return checkoutCandidates().filter((candidate) => candidate.variantId !== 'checkout.card-upi-combined');
}

/** Variant file definitions for a screen (for store/learner tests). */
export function variantDefinitions(screenId: ScreenId): VariantDefinition[] {
  const specs = screenId === 'checkout' ? CHECKOUT_VARIANTS : LOGIN_VARIANTS;
  return specs.map((spec) => {
    const required = spec.required.map(toElementId);
    const optional = (spec.optional ?? []).map(toElementId);
    const excluded = spec.excluded.map(toElementId);
    const definition: VariantDefinition = {
      schemaVersion: 2,
      screenId,
      variantId: toVariantId(spec.variantId),
      required,
      optional,
      excluded,
      fingerprintStamp: computeVariantFingerprintStamp({
        screenId,
        variantId: spec.variantId,
        required,
        optional,
        excluded,
      }),
      learnedAt: '2026-11-13T10:00:00Z',
      learnedFrom: 'fixture',
    };
    return definition;
  });
}

/** Fresh dump of the checkout screen in the card variant state. */
export function freshCheckoutCard(): CoreHierarchyNode[] {
  return freshNodes('checkout' as ScreenId, [
    'checkout.help',
    'checkout.back',
    'checkout.card-number',
    'checkout.expiry',
    'checkout.cvv',
    'checkout.pay',
    'checkout.save-card',
  ]);
}

/** Fresh dump of the checkout screen in the method-picker state. */
export function freshCheckoutPicker(): CoreHierarchyNode[] {
  return freshNodes('checkout' as ScreenId, [
    'checkout.help',
    'checkout.back',
    'checkout.cod-option',
    'checkout.card-option',
    'checkout.upi-option',
  ]);
}

/** Fresh dump of the checkout screen with card AND UPI fields present. */
export function freshCheckoutCardAndUpi(): CoreHierarchyNode[] {
  return freshNodes('checkout' as ScreenId, [
    'checkout.help',
    'checkout.back',
    'checkout.card-number',
    'checkout.expiry',
    'checkout.cvv',
    'checkout.pay',
    'checkout.save-card',
    'checkout.upi-id',
    'checkout.upi-pay',
  ]);
}

/** Fresh dump of the checkout screen in the COD state. */
export function freshCheckoutCod(): CoreHierarchyNode[] {
  return freshNodes('checkout' as ScreenId, [
    'checkout.help',
    'checkout.back',
    'checkout.cod-confirm',
  ]);
}

/** Fresh dump of the login screen in the password state. */
export function freshLoginPassword(): CoreHierarchyNode[] {
  return freshNodes('login' as ScreenId, [
    'login.help',
    'login.back',
    'login.username',
    'login.password',
    'login.submit',
  ]);
}

/** Fresh dump of the login screen in the OTP state. */
export function freshLoginOtp(): CoreHierarchyNode[] {
  return freshNodes('login' as ScreenId, ['login.help', 'login.back', 'login.otp-field', 'login.verify-otp']);
}

/** Element id helper for tests building ids by hand. */
export function elementId(value: string): ElementId {
  return toElementId(value);
}

/**
 * Write one fixture screen's learned tree into a temp project root:
 * `elements.json` plus every variant file, under
 * `<projectRoot>/.testorbit/<platform>/screens/<screenId>/`.
 * Test data only — never a flow, never shipped as an example.
 */
export function writeFixtureScreenTree(projectRoot: string, platform: Platform, screenId: ScreenId): void {
  const screenDir = path.join(projectRoot, '.testorbit', platform, 'screens', screenId);
  fs.mkdirSync(path.join(screenDir, 'variants'), { recursive: true });
  const elements = baseElements(screenId).map((element) => ({
    id: element.id,
    stableSelector: element.selector,
    clickable: element.clickable,
    enabled: element.enabled,
  }));
  fs.writeFileSync(path.join(screenDir, 'elements.json'), JSON.stringify(elements, null, 2), 'utf8');
  // Pin elements.json mtime to the fixture learn time: generate-map's stale
  // check reads elements.json mtime as a last-learn signal, so a wall-clock
  // mtime would make edges go stale once real time passes the fixture
  // recording time (all fixture variants carry this same learnedAt).
  const learnedAt = new Date('2026-11-13T10:00:00Z');
  fs.utimesSync(path.join(screenDir, 'elements.json'), learnedAt, learnedAt);
  for (const definition of variantDefinitions(screenId)) {
    fs.writeFileSync(
      path.join(screenDir, 'variants', `${definition.variantId}.json`),
      JSON.stringify(definition, null, 2),
      'utf8',
    );
  }
}
