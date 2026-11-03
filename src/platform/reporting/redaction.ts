const SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*)["']?[^"'\\s,;]+/gi,
  /(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi
];

/** Redact common credential forms and explicitly supplied variable values. */
export function redactSensitiveText(input: string, secrets: readonly string[] = []): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, '$1[REDACTED]');
  for (const secret of secrets) if (secret.length >= 3) output = output.split(secret).join('[REDACTED]');
  return output;
}
