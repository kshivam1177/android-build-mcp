import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../reporting/redaction.js';

describe('report redaction', () => {
  it('redacts explicit runtime values and common bearer credentials', () => {
    const output = redactSensitiveText('token=abc123 Authorization: Bearer xyz987', ['abc123']);
    expect(output).not.toContain('abc123');
    expect(output).not.toContain('xyz987');
    expect(output).toContain('[REDACTED]');
  });
});
