/**
 * Redactor tests (D6) — secrets are removed at the output boundary and
 * a leak is detectable.
 */
import { describe, expect, it } from 'vitest';
import { containsSecret, redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('replaces every secret and leaves other text alone', () => {
    const redacted = redactSecrets('typed hunter2 then hunter2 again', ['hunter2']);
    expect(redacted).toBe('typed [REDACTED] then [REDACTED] again');
    expect(containsSecret(redacted, ['hunter2'])).toBe(false);
  });

  it('ignores empty secrets and reports a leak when present', () => {
    expect(redactSecrets('clean text', ['', 'zz-nope'])).toBe('clean text');
    expect(containsSecret('leaked hunter2', ['hunter2'])).toBe(true);
    expect(containsSecret('clean', ['hunter2'])).toBe(false);
  });
});
