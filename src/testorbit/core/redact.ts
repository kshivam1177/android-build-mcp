/**
 * The one shared redactor (Part D, D6) — used by the converter, the
 * report writer, and the failure-bundle writer. Typed values, passwords,
 * and tokens are redacted at the output boundary, before any log line,
 * report, or bundle is written; the same redactor is used everywhere,
 * so a second copy of it is a defect.
 *
 * Pure logic, no I/O.
 */

/** Placeholder written wherever a secret value was removed. */
export const REDACTED = '[REDACTED]';

/**
 * Replace every occurrence of each non-empty secret in `text`.
 *
 * @param text - Text to redact (a log line, report field, or bundle).
 * @param secrets - Secret values to remove; empty strings are ignored.
 * @returns The text with each secret replaced by `[REDACTED]`.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join(REDACTED);
  }
  return redacted;
}

/**
 * Check whether `text` still contains any non-empty secret.
 *
 * @param text - Text to check.
 * @param secrets - Secret values that must not appear.
 * @returns True when any secret occurs in the text.
 */
export function containsSecret(text: string, secrets: readonly string[]): boolean {
  return secrets.some((secret) => secret.length > 0 && text.includes(secret));
}
