import { describe, expect, it } from 'vitest';
import { errorResult } from '../response.js';
import { TestOrbitError, UnknownVariantError } from '../../testorbit/domain/errors.js';
import { TestOrbitFrameworkError } from '../../types.js';

describe('errorResult', () => {
  it('maps a TestOrbitError to its code, message, remediation, and context', () => {
    const error = new UnknownVariantError(
      'No variant matched screen "checkout".',
      'Learn it: orbit learn --screen checkout --variantId <name>',
      { screenId: 'checkout' },
    );
    const result = errorResult(error);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[UNKNOWN_VARIANT]');
    expect(text).toContain('No variant matched');
    expect(text).toContain('orbit learn --screen checkout');
    expect(text).toContain('checkout');
  });

  it('keeps the TestOrbitFrameworkError mapping unchanged', () => {
    const result = errorResult(new TestOrbitFrameworkError('STALE_SNAPSHOT', 'No snapshot cached.'));
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[STALE_SNAPSHOT]');
  });

  it('still wraps an unknown error as UNEXPECTED_ERROR', () => {
    const result = errorResult(new Error('boom'));
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[UNEXPECTED_ERROR] boom');
  });

  it('maps a bare TestOrbitError code', () => {
    const result = errorResult(new TestOrbitError('ELEMENT_IDENTITY', 'No id.', 'Add a resourceId.', {}));
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[ELEMENT_IDENTITY]');
    expect(text).toContain('Add a resourceId.');
  });
});
