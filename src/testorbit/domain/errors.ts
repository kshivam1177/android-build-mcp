/**
 * TestOrbit typed error hierarchy (Part D, D6).
 *
 * Every TestOrbit error carries a stable `code`, a human-readable message, a
 * `remediation` telling the caller what to do next, and a `context` map of
 * string fields naming the values involved. No bare `throw new Error(...)`
 * in TestOrbit code.
 */
export class TestOrbitError extends Error {
  readonly code: string;
  readonly context: Readonly<Record<string, string>>;
  readonly remediation: string;

  /**
   * @param code - Stable machine-readable code, e.g. `UNKNOWN_VARIANT`.
   * @param message - Human-readable description of what went wrong.
   * @param remediation - What the caller should do next.
   * @param context - Named string values involved (ids, paths, field names).
   */
  constructor(
    code: string,
    message: string,
    remediation: string,
    context: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'TestOrbitError';
    this.code = code;
    this.context = context;
    this.remediation = remediation;
  }
}

/** A screen's variants were checked and none matched the fresh hierarchy. */
export class UnknownVariantError extends TestOrbitError {
  /**
   * @param message - What was checked and what did not match.
   * @param remediation - How to learn the missing variant.
   * @param context - Screen/variant ids and evidence paths.
   */
  constructor(message: string, remediation: string, context: Readonly<Record<string, string>> = {}) {
    super('UNKNOWN_VARIANT', message, remediation, context);
    this.name = 'UnknownVariantError';
  }
}

/** No learned screen matched the fresh hierarchy. */
export class UnknownScreenError extends TestOrbitError {
  /**
   * @param message - What was checked and what did not match.
   * @param remediation - How to learn the missing screen.
   * @param context - Screen id and evidence paths.
   */
  constructor(message: string, remediation: string, context: Readonly<Record<string, string>> = {}) {
    super('UNKNOWN_SCREEN', message, remediation, context);
    this.name = 'UnknownScreenError';
  }
}

/** A referenced element id or selector has no node in the fresh hierarchy. */
export class ElementNotFoundError extends TestOrbitError {
  /**
   * @param message - Which element was not found, and where it was expected.
   * @param remediation - How to re-learn or fix the reference.
   * @param context - Element and screen ids.
   */
  constructor(message: string, remediation: string, context: Readonly<Record<string, string>> = {}) {
    super('ELEMENT_NOT_FOUND', message, remediation, context);
    this.name = 'ElementNotFoundError';
  }
}

/** A TestOrbit file's schemaVersion is unknown or its content fails validation. */
export class SchemaVersionError extends TestOrbitError {
  /**
   * @param message - Which file and version failed, and why.
   * @param remediation - How to migrate or re-learn the file.
   * @param context - File path and versions involved.
   */
  constructor(message: string, remediation: string, context: Readonly<Record<string, string>> = {}) {
    super('SCHEMA_VERSION', message, remediation, context);
    this.name = 'SchemaVersionError';
  }
}

/** A recording or test case could not be converted (Phase 4). */
export class ConversionError extends TestOrbitError {
  /**
   * @param message - Which step or element could not be converted, and why.
   * @param remediation - How to fix the recording or learned screen.
   * @param context - Test, step, and element ids.
   */
  constructor(message: string, remediation: string, context: Readonly<Record<string, string>> = {}) {
    super('CONVERSION_ERROR', message, remediation, context);
    this.name = 'ConversionError';
  }
}

/** A test runner (Maestro, Playwright) failed to run or report. */
export class RunnerError extends TestOrbitError {
  /**
   * @param message - Which runner failed, and how.
   * @param remediation - How to retry or fix the runner setup.
   * @param context - Runner name, command, and exit code.
   */
  constructor(message: string, remediation: string, context: Readonly<Record<string, string>> = {}) {
    super('RUNNER_ERROR', message, remediation, context);
    this.name = 'RunnerError';
  }
}

/**
 * A hierarchy node cannot be given a stable element id (B3): it has no
 * resourceId and no contentDesc, and no ancestor in its chain carries a
 * resourceId to anchor the fallback. Learning fails loudly instead of
 * emitting a className-only id.
 */
export class ElementIdentityError extends TestOrbitError {
  /**
   * @param message - Which node could not be identified, and why.
   * @param remediation - How to make the element identifiable.
   * @param context - Node ref, class, and screen id.
   */
  constructor(message: string, remediation: string, context: Readonly<Record<string, string>> = {}) {
    super('ELEMENT_IDENTITY', message, remediation, context);
    this.name = 'ElementIdentityError';
  }
}
