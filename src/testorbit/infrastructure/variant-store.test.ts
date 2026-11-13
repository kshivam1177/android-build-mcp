import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VariantStore } from './variant-store.js';
import { detectVariant } from '../core/variant-match.js';
import { checkoutCandidates, freshCheckoutCard, DISPLAY, writeFixtureScreenTree } from '../test-fixtures/variants.js';
import { toScreenId } from '../domain/types.js';

/** Temp project with the checkout screen tree written. */
function makeStore(): { projectRoot: string; store: VariantStore } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-store-'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
  return { projectRoot, store: new VariantStore(projectRoot, 'android') };
}

describe('VariantStore — loading', () => {
  let projectRoot: string;
  let store: VariantStore;

  beforeEach(() => {
    ({ projectRoot, store } = makeStore());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('lists learned screens and loads one with its variants', () => {
    expect(store.listScreens()).toEqual(['checkout']);
    const screen = store.loadScreen(toScreenId('checkout'));
    expect(screen?.baseElements).toHaveLength(13);
    expect(screen?.variants).toHaveLength(6);
  });

  it('returns null for a screen with no folder', () => {
    expect(store.loadScreen(toScreenId('login'))).toBeNull();
  });
});

describe('VariantStore — candidates', () => {
  let projectRoot: string;
  let store: VariantStore;

  beforeEach(() => {
    ({ projectRoot, store } = makeStore());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('builds candidates that detect the card variant', () => {
    const screen = store.loadScreen(toScreenId('checkout'));
    expect(screen).not.toBeNull();
    if (screen === null) return;
    const result = detectVariant(store.buildCandidates(screen), freshCheckoutCard(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.online-card');
  });

  it('builds the same candidates as the pure fixtures', () => {
    const screen = store.loadScreen(toScreenId('checkout'));
    expect(screen).not.toBeNull();
    if (screen === null) return;
    const fromStore = store.buildCandidates(screen).map((candidate) => candidate.variantId).sort();
    const fromFixtures = checkoutCandidates().map((candidate) => candidate.variantId).sort();
    expect(fromStore).toEqual(fromFixtures);
  });

  it('fails loudly when a variant references an unknown element id', () => {
    const variantsDir = path.join(projectRoot, '.testorbit', 'android', 'screens', 'checkout', 'variants');
    const bad = {
      schemaVersion: 2,
      screenId: 'checkout',
      variantId: 'checkout.broken',
      required: ['checkout.no-such-element'],
      optional: [],
      excluded: [],
      fingerprintStamp: `sha256:${'b'.repeat(64)}`,
      learnedAt: '2026-11-13T10:00:00Z',
    };
    fs.writeFileSync(path.join(variantsDir, 'checkout.broken.json'), JSON.stringify(bad), 'utf8');
    const screen = store.loadScreen(toScreenId('checkout'));
    expect(screen).not.toBeNull();
    if (screen === null) return;
    expect(() => store.buildCandidates(screen)).toThrow(/checkout\.no-such-element/);
  });
});
