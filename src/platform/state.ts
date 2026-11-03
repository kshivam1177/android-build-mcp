import type { PlatformSnapshot } from './contracts.js';

export type ObservedUiState = 'loading' | 'success' | 'empty' | 'error' | 'validation' | 'authentication' | 'permission' | 'unexpected';

export interface StateClassification {
  state: ObservedUiState;
  confidence: 'high' | 'medium' | 'low';
  matchedSignals: string[];
}

/** Deterministic, explainable state classification. It does not use an LLM or infer business success from a click. */
export function classifyUiState(snapshot: PlatformSnapshot): StateClassification {
  const text = snapshot.nodes
    .filter((node) => node.visible !== false)
    .flatMap((node) => [node.text, node.label, node.value])
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase();
  const rules: Array<{ state: ObservedUiState; patterns: RegExp[] }> = [
    { state: 'error', patterns: [/\berror\b/, /\bfailed\b/, /\bsomething went wrong\b/, /\btry again\b/] },
    { state: 'permission', patterns: [/\ballow access\b/, /\ballow\b.*\baccess\b/, /\bpermission\b/, /\bwhile using the app\b/] },
    { state: 'authentication', patterns: [/\bsign in\b/, /\blog in\b/, /\bpassword\b/, /\bone.time password\b/, /\botp\b/] },
    { state: 'validation', patterns: [/\brequired\b/, /\binvalid\b/, /\bplease enter\b/, /\bdoes not match\b/] },
    { state: 'empty', patterns: [/\bno results\b/, /\bnothing here\b/, /\bno data\b/, /\bno items\b/] },
    { state: 'success', patterns: [/\bsuccessfully\b/, /\bsaved\b/, /\bcompleted\b/, /\border confirmed\b/] },
    { state: 'loading', patterns: [/\bloading\b/, /\bplease wait\b/, /\bprocessing\b/, /\bskeleton\b/] }
  ];
  for (const rule of rules) {
    const matchedSignals = rule.patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
    if (matchedSignals.length) return { state: rule.state, confidence: matchedSignals.length > 1 ? 'high' : 'medium', matchedSignals };
  }
  return { state: 'unexpected', confidence: 'low', matchedSignals: [] };
}
