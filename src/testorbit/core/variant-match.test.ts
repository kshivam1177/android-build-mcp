import { describe, expect, it } from 'vitest';
import { detectVariant, identifyScreen } from './variant-match.js';
import {
  DISPLAY,
  checkoutCandidates,
  checkoutCandidatesWithoutCombined,
  freshCheckoutCard,
  freshCheckoutCardAndUpi,
  freshCheckoutCod,
  freshCheckoutPicker,
  freshLoginOtp,
  freshLoginPassword,
  freshNodes,
  loginCandidates,
} from '../test-fixtures/variants.js';
import { toScreenId } from '../domain/types.js';

describe('detectVariant — checkout', () => {
  it('detects the card variant from card fields', () => {
    const result = detectVariant(checkoutCandidates(), freshCheckoutCard(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.online-card');
  });

  it('detects the COD variant from the COD confirm button', () => {
    const result = detectVariant(checkoutCandidates(), freshCheckoutCod(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.cod');
  });

  it('detects the method-picker variant from the option rows only', () => {
    const result = detectVariant(checkoutCandidates(), freshCheckoutPicker(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.method-picker');
  });

  it('detects the combined variant when card and UPI fields are both present', () => {
    const result = detectVariant(checkoutCandidates(), freshCheckoutCardAndUpi(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('checkout.card-upi-combined');
  });

  it('fails naming both variants when card and UPI are present but no combined file exists', () => {
    const result = detectVariant(checkoutCandidatesWithoutCombined(), freshCheckoutCardAndUpi(), DISPLAY);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toContain('checkout.online-card');
      expect(result.candidates).toContain('checkout.upi');
    }
  });

  it('returns unknown with evidence when no variant matches', () => {
    const fresh = freshNodes(toScreenId('login'), ['login.username', 'login.password', 'login.submit']);
    const result = detectVariant(checkoutCandidates(), fresh, DISPLAY);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.checked).toContain('checkout.online-card');
      expect(result.evidence.length).toBeGreaterThan(0);
    }
  });

  it('falls back to default only when no specific variant matches', () => {
    const fresh = freshNodes(toScreenId('checkout'), ['checkout.help', 'checkout.back']);
    const result = detectVariant(checkoutCandidates(), fresh, DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('default');
  });
});

describe('detectVariant — login (second domain)', () => {
  it('detects the password variant', () => {
    const result = detectVariant(loginCandidates(), freshLoginPassword(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('login.password');
  });

  it('detects the OTP variant', () => {
    const result = detectVariant(loginCandidates(), freshLoginOtp(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.variantId).toBe('login.otp');
  });
});

describe('identifyScreen — across screens', () => {
  it('identifies the checkout card screen from scratch', () => {
    const result = identifyScreen([...checkoutCandidates(), ...loginCandidates()], freshCheckoutCard(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') {
      expect(result.screenId).toBe('checkout');
      expect(result.variantId).toBe('checkout.online-card');
    }
  });

  it('identifies the login OTP screen from scratch', () => {
    const result = identifyScreen([...checkoutCandidates(), ...loginCandidates()], freshLoginOtp(), DISPLAY);
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') {
      expect(result.screenId).toBe('login');
      expect(result.variantId).toBe('login.otp');
    }
  });

  it('returns unknown when no learned screen matches', () => {
    const fresh = freshNodes(toScreenId('login'), ['login.sso-google', 'login.sso-apple', 'login.help', 'login.back']);
    const result = identifyScreen(checkoutCandidates(), fresh, DISPLAY);
    expect(result.kind).toBe('unknown');
  });

  it('fails naming candidates on an exact tie', () => {
    const candidates = checkoutCandidates();
    const first = candidates[0];
    if (first === undefined) throw new Error('checkout fixture is empty');
    const duplicate = { ...first, variantId: 'checkout.duplicate' } as typeof first;
    const tied = [first, duplicate];
    const fresh = freshNodes(toScreenId('checkout'), ['checkout.help', 'checkout.back']);
    const result = identifyScreen(tied, fresh, DISPLAY);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2);
  });
});
