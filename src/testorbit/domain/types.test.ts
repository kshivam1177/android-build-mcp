import { describe, expect, it } from 'vitest';
import {
  isPlatform,
  PlatformSchema,
  toElementId,
  toScreenId,
  toTestId,
  toVariantId,
  validateAppRoute,
} from './types.js';
import { TestOrbitError } from './errors.js';

describe('branded id factories', () => {
  it('accepts a valid screen id and rejects an unsafe one', () => {
    expect(toScreenId('checkout').length).toBeGreaterThan(0);
    expect(() => toScreenId('../checkout')).toThrow(TestOrbitError);
    expect(() => toScreenId('')).toThrow(TestOrbitError);
  });

  it('accepts a valid variant id', () => {
    expect(toVariantId('checkout.online-card').length).toBeGreaterThan(0);
    expect(() => toVariantId('checkout online card')).toThrow(TestOrbitError);
  });

  it('accepts element ids with @ancestor and #n suffixes', () => {
    expect(toElementId('checkout.pay-now').length).toBeGreaterThan(0);
    expect(toElementId('checkout.pay-now@header').length).toBeGreaterThan(0);
    expect(toElementId('product-list.add-to-cart#2').length).toBeGreaterThan(0);
    expect(() => toElementId('pay-now')).toThrow(TestOrbitError);
    expect(() => toElementId('checkout.')).toThrow(TestOrbitError);
  });

  it('accepts a valid test id', () => {
    expect(toTestId('checkout-cod').length).toBeGreaterThan(0);
    expect(() => toTestId('checkout cod')).toThrow(TestOrbitError);
  });

  it('names the invalid field in the thrown error context', () => {
    try {
      toScreenId('../x');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TestOrbitError);
      expect((error as TestOrbitError).context.field).toBe('screenId');
      expect((error as TestOrbitError).remediation.length).toBeGreaterThan(0);
    }
  });
});

describe('Platform', () => {
  it('validates the four supported platforms through Zod', () => {
    expect(PlatformSchema.parse('android')).toBe('android');
    expect(PlatformSchema.parse('ios')).toBe('ios');
    expect(PlatformSchema.parse('flutter')).toBe('flutter');
    expect(PlatformSchema.parse('web')).toBe('web');
    expect(() => PlatformSchema.parse('windows')).toThrow();
  });

  it('narrows a runtime string with isPlatform', () => {
    expect(isPlatform('android')).toBe(true);
    expect(isPlatform('windows')).toBe(false);
  });
});

describe('validateAppRoute', () => {
  it('accepts an absent route as unvalidated', () => {
    expect(() => validateAppRoute(undefined)).not.toThrow();
  });

  it('accepts a well-formed route', () => {
    expect(() => validateAppRoute('/checkout/payment_1')).not.toThrow();
  });

  it('fails naming the appRoute field when the route is invalid', () => {
    for (const bad of ['checkout', '/Checkout', '/check out', '/checkout?x=1']) {
      try {
        validateAppRoute(bad);
        expect.unreachable(`expected ${bad} to fail`);
      } catch (error) {
        expect(error).toBeInstanceOf(TestOrbitError);
        expect((error as TestOrbitError).context.field).toBe('appRoute');
      }
    }
  });
});
