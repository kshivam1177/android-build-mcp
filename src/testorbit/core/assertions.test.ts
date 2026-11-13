/**
 * Redactor and assertion-helper tests (D6, C2) — secrets are removed,
 * the unique-required rule picks the variant-unique element and falls
 * back to all required elements, env-var names follow the C2 rule.
 */
import { describe, expect, it } from 'vitest';
import { assertionElementIds, envVarFor, maestroKeyName, swipeDirection, uniqueRequiredElement } from './assertions.js';
import { toElementId } from '../domain/types.js';

describe('assertion emission rule', () => {
  it('picks the first required element unique to the variant', () => {
    const required = [toElementId('checkout.card-number'), toElementId('checkout.pay')];
    const siblings = [[toElementId('checkout.card-number')], [toElementId('checkout.upi-id')]];
    expect(uniqueRequiredElement(required, siblings)).toBe(toElementId('checkout.pay'));
    expect(assertionElementIds(required, siblings)).toEqual([toElementId('checkout.pay')]);
  });

  it('falls back to all required elements when none is unique', () => {
    const required = [toElementId('checkout.card-number')];
    const siblings = [[toElementId('checkout.card-number')]];
    expect(uniqueRequiredElement(required, siblings)).toBeNull();
    expect(assertionElementIds(required, siblings)).toEqual(required);
  });
});

describe('env-var naming, swipe direction, key mapping', () => {
  it('names typed values TEST_<SCREEN>_<ELEMENT_SLUG>', () => {
    expect(envVarFor('login', 'login.password')).toBe('TEST_LOGIN_PASSWORD');
    expect(envVarFor('checkout', 'checkout.card-number')).toBe('TEST_CHECKOUT_CARD_NUMBER');
    expect(envVarFor('checkout', 'checkout.card-number#2')).toBe('TEST_CHECKOUT_CARD_NUMBER');
  });

  it('derives the dominant-axis swipe direction', () => {
    expect(swipeDirection({ x: 50, y: 800 }, { x: 50, y: 200 })).toBe('UP');
    expect(swipeDirection({ x: 100, y: 400 }, { x: 900, y: 400 })).toBe('RIGHT');
    expect(swipeDirection({ x: 500, y: 100 }, { x: 500, y: 900 })).toBe('DOWN');
    expect(swipeDirection({ x: 900, y: 400 }, { x: 100, y: 400 })).toBe('LEFT');
  });

  it('strips the KEYCODE_ prefix for pressKey', () => {
    expect(maestroKeyName('KEYCODE_BACK')).toBe('BACK');
    expect(maestroKeyName('ENTER')).toBe('ENTER');
  });
});
