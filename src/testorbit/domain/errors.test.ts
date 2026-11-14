import { describe, expect, it } from 'vitest';
import {
  ConversionError,
  ElementIdentityError,
  ElementNotFoundError,
  TestOrbitError,
  RunnerError,
  SchemaVersionError,
  UnknownScreenError,
  UnknownVariantError,
} from './errors.js';

const cases: Array<{ make: () => TestOrbitError; code: string; name: string }> = [
  { make: () => new UnknownVariantError('no variant', 'learn it'), code: 'UNKNOWN_VARIANT', name: 'UnknownVariantError' },
  { make: () => new UnknownScreenError('no screen', 'learn it'), code: 'UNKNOWN_SCREEN', name: 'UnknownScreenError' },
  { make: () => new ElementNotFoundError('no element', 're-learn it'), code: 'ELEMENT_NOT_FOUND', name: 'ElementNotFoundError' },
  { make: () => new SchemaVersionError('bad version', 'migrate it'), code: 'SCHEMA_VERSION', name: 'SchemaVersionError' },
  { make: () => new ConversionError('cannot convert', 'fix the step'), code: 'CONVERSION_ERROR', name: 'ConversionError' },
  { make: () => new RunnerError('runner failed', 'retry it'), code: 'RUNNER_ERROR', name: 'RunnerError' },
  { make: () => new ElementIdentityError('no anchor', 'add a resourceId'), code: 'ELEMENT_IDENTITY', name: 'ElementIdentityError' },
];

describe('TestOrbitError hierarchy', () => {
  it('carries code, message, remediation, and context on the base class', () => {
    const error = new TestOrbitError('SOME_CODE', 'broke', 'fix it', { field: 'x' });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('SOME_CODE');
    expect(error.message).toBe('broke');
    expect(error.remediation).toBe('fix it');
    expect(error.context).toEqual({ field: 'x' });
  });

  it.each(cases)('$name reports code $code', ({ make, code, name }) => {
    const error = make();
    expect(error).toBeInstanceOf(TestOrbitError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
    expect(error.remediation.length).toBeGreaterThan(0);
  });
});
