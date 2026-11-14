/**
 * Screen-reference rewriting tests (Phase 6, D11) — ids are relabelled
 * by exact match or `<screen>.` prefix, env-var prefixes follow the
 * screen, and a variant file gets a fresh fingerprint stamp.
 */
import { describe, expect, it } from 'vitest';
import { computeVariantFingerprintStamp } from '../core/fingerprint.js';
import { toElementId } from '../domain/types.js';
import { deepRewrite, refreshVariantStamp, relabelEnvVars, relabelId, screaming } from './screen-references.js';

describe('screen-references', () => {
  it('relabels exact screen ids and dotted ids, and leaves the rest', () => {
    expect(relabelId('login', 'login', 'signin')).toBe('signin');
    expect(relabelId('login.password', 'login', 'signin')).toBe('signin.password');
    expect(relabelId('login-flow', 'login', 'signin')).toBe('login-flow');
    expect(relabelId('checkout.pay', 'login', 'signin')).toBe('checkout.pay');
  });

  it('rewrites TEST_<SCREEN>_ env-var prefixes', () => {
    expect(relabelEnvVars('${TEST_LOGIN_PASSWORD}', 'LOGIN', 'SIGNIN')).toBe('${TEST_SIGNIN_PASSWORD}');
    expect(screaming('login')).toBe('LOGIN');
  });

  it('deep-rewrites ids inside parsed JSON values', () => {
    const rewritten = deepRewrite(
      { screen: 'login', steps: [{ elementId: 'login.submit' }], note: 'login-flow' },
      'login',
      'signin',
      'LOGIN',
      'SIGNIN',
    ) as { screen: string; steps: { elementId: string }[]; note: string };
    expect(rewritten.screen).toBe('signin');
    expect(rewritten.steps[0]?.elementId).toBe('signin.submit');
    expect(rewritten.note).toBe('login-flow');
  });

  it('refreshes a variant stamp and leaves non-variant files alone', () => {
    const variant = {
      schemaVersion: 2,
      screenId: 'signin',
      variantId: 'signin.password',
      required: ['signin.submit'],
      optional: [],
      excluded: [],
      fingerprintStamp: 'sha256:stale',
      learnedAt: '2026-11-13T10:00:00Z',
    };
    const refreshed = refreshVariantStamp({ filePath: 'variants/signin.password.json', contents: JSON.stringify(variant) });
    const parsed = JSON.parse(refreshed.contents) as { fingerprintStamp: string };
    expect(parsed.fingerprintStamp).toBe(
      computeVariantFingerprintStamp({
        screenId: 'signin',
        variantId: 'signin.password',
        required: ['signin.submit'].map(toElementId),
        optional: [],
        excluded: [],
      }),
    );
    const untouched = refreshVariantStamp({ filePath: 'screen.json', contents: JSON.stringify({ screenId: 'signin' }) });
    expect(untouched.contents).toContain('signin');
  });
});
