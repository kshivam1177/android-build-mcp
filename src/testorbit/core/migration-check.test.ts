/**
 * Migration-coverage tests (Phase 6, C16) — disappeared ids need a
 * mapping or a `removed` entry; a mapping's `to` must exist in a
 * target screen and its `from` must be gone from the old screen.
 */
import { describe, expect, it } from 'vitest';
import { checkMigrationCoverage } from './migration-check.js';
import { toElementId, toScreenId } from '../domain/types.js';
import type { MigrationList } from '../domain/screen-map.js';

/** One migration list covering the given mappings and removals. */
function migrationList(mappings: [string, string][], removed: string[]): MigrationList {
  return {
    schemaVersion: 2,
    migration: 'checkout-split-2026-11-13',
    reason: 'Checkout grew a separate payment step.',
    fromScreen: toScreenId('checkout'),
    toScreens: [toScreenId('checkout'), toScreenId('checkout-payment')],
    mappings: mappings.map(([from, to]) => ({ from: toElementId(from), to: toElementId(to) })),
    removed: removed.map(toElementId),
    createdAt: '2026-11-13T10:00:00Z',
  };
}

describe('checkMigrationCoverage', () => {
  it('passes when every disappeared id is mapped or removed', () => {
    const result = checkMigrationCoverage(
      [toElementId('checkout.pay-now'), toElementId('checkout.promo-banner')],
      [toElementId('checkout.help')],
      [migrationList([['checkout.pay-now', 'checkout-payment.pay-now']], ['checkout.promo-banner'])],
      new Map([
        [toScreenId('checkout'), new Set([toElementId('checkout.help')])],
        [toScreenId('checkout-payment'), new Set([toElementId('checkout-payment.pay-now')])],
      ]),
    );
    expect(result.uncovered).toEqual([]);
    expect(result.invalidMappings).toEqual([]);
  });

  it('reports disappeared ids with no mapping and no removed entry', () => {
    const result = checkMigrationCoverage(
      [toElementId('checkout.pay-now'), toElementId('checkout.promo-banner')],
      [toElementId('checkout.help')],
      [],
      new Map([[toScreenId('checkout'), new Set([toElementId('checkout.help')])]]),
    );
    expect(result.uncovered).toEqual([toElementId('checkout.pay-now'), toElementId('checkout.promo-banner')]);
  });

  it('flags a mapping whose to id does not exist in any target screen', () => {
    const result = checkMigrationCoverage(
      [toElementId('checkout.pay-now')],
      [toElementId('checkout.help')],
      [migrationList([['checkout.pay-now', 'checkout-payment.pay-now']], [])],
      new Map([[toScreenId('checkout'), new Set([toElementId('checkout.help')])]]),
    );
    expect(result.uncovered).toEqual([]);
    expect(result.invalidMappings).toHaveLength(1);
    expect(result.invalidMappings[0]).toContain('checkout-payment.pay-now');
  });

  it('flags a mapping whose from id is still present', () => {
    const result = checkMigrationCoverage(
      [toElementId('checkout.old')],
      [toElementId('checkout.pay-now')],
      [migrationList([['checkout.pay-now', 'checkout-payment.pay-now']], [])],
      new Map([
        [toScreenId('checkout'), new Set([toElementId('checkout.pay-now')])],
        [toScreenId('checkout-payment'), new Set([toElementId('checkout-payment.pay-now')])],
      ]),
    );
    expect(result.invalidMappings).toHaveLength(1);
    expect(result.invalidMappings[0]).toContain('still present');
  });
});
