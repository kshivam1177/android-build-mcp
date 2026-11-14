import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DetectVariantUseCase, serialiseDetectionResult } from './detect-variant.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import {
  DISPLAY,
  freshCheckoutCard,
  freshCheckoutCardAndUpi,
  freshCheckoutPicker,
  freshLoginOtp,
  writeFixtureScreenTree,
} from '../test-fixtures/variants.js';
import { toScreenId } from '../domain/types.js';
import type { CoreHierarchyNode } from '../domain/types.js';

/** Temp project with checkout + login screens learned. */
function makeUseCase(): { projectRoot: string; useCase: DetectVariantUseCase } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-detect-'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  return { projectRoot, useCase: new DetectVariantUseCase(new VariantStore(projectRoot, 'android')) };
}

/** Detect within the checkout screen of a temp project. */
function detectCheckout(
  useCase: DetectVariantUseCase,
  projectRoot: string,
  nodes: readonly CoreHierarchyNode[],
) {
  return useCase.detectForScreen({
    projectRoot,
    platform: 'android',
    screenId: toScreenId('checkout'),
    nodes,
    display: DISPLAY,
  });
}

describe('DetectVariantUseCase — within a screen', () => {
  let projectRoot: string;
  let useCase: DetectVariantUseCase;

  beforeEach(() => {
    ({ projectRoot, useCase } = makeUseCase());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('detects the card variant within the checkout screen', () => {
    const result = detectCheckout(useCase, projectRoot, freshCheckoutCard());
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.online-card');
  });

  it('detects the method-picker variant (a legitimate state, not unknown)', () => {
    const result = useCase.detect({
      projectRoot,
      platform: 'android',
      screenId: toScreenId('checkout'),
      nodes: freshCheckoutPicker(),
      display: DISPLAY,
    });
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.method-picker');
  });

  it('reports the combined variant when card and UPI are both present', () => {
    const result = detectCheckout(useCase, projectRoot, freshCheckoutCardAndUpi());
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.card-upi-combined');
  });
});

describe('DetectVariantUseCase — across screens and serialisation', () => {
  let projectRoot: string;
  let useCase: DetectVariantUseCase;

  beforeEach(() => {
    ({ projectRoot, useCase } = makeUseCase());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('identifies the login OTP screen from scratch', () => {
    const result = useCase.identify({ projectRoot, platform: 'android', nodes: freshLoginOtp(), display: DISPLAY });
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') {
      expect(result.screenId).toBe('login');
      expect(result.variantId).toBe('login.otp');
    }
  });

  it('throws a typed error with the learn command for an unlearned screen', () => {
    let caught: unknown;
    try {
      useCase.detectForScreen({
        projectRoot,
        platform: 'android',
        screenId: toScreenId('settings'),
        nodes: freshCheckoutCard(),
        display: DISPLAY,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'UNKNOWN_SCREEN' });
    expect((caught as { remediation: string }).remediation).toMatch(/orbit learn --screen settings/);
  });

  it('serialises a matched result through the detection schema', () => {
    const matched = detectCheckout(useCase, projectRoot, freshCheckoutCard());
    const serialisedMatched = serialiseDetectionResult(matched);
    expect(serialisedMatched.kind).toBe('matched');
    if (serialisedMatched.kind === 'matched') {
      expect(serialisedMatched.variantId).toBe('checkout.online-card');
      expect(serialisedMatched.evidence.matched).toBe(true);
    }
  });

  it('serialises an unknown result with evidence', () => {
    const unknown = detectCheckout(useCase, projectRoot, freshLoginOtp());
    expect(unknown.kind).toBe('unknown');
    const serialisedUnknown = serialiseDetectionResult(unknown);
    expect(serialisedUnknown.kind).toBe('unknown');
    if (serialisedUnknown.kind === 'unknown') expect(serialisedUnknown.evidence.length).toBeGreaterThan(0);
  });
});
