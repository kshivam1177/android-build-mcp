import { AutomationError, type PlatformSnapshot, type SemanticSelector } from './contracts.js';
import { resolveSemanticSelector } from './selectors.js';

export type SnapshotAssertion =
  | { kind: 'exists'; selector: SemanticSelector }
  | { kind: 'visible'; selector: SemanticSelector }
  | { kind: 'enabled'; selector: SemanticSelector }
  | { kind: 'textEquals'; selector: SemanticSelector; expected: string }
  | { kind: 'textContains'; selector: SemanticSelector; expected: string };

export interface AssertionResult {
  passed: boolean;
  kind: SnapshotAssertion['kind'];
  message: string;
  expected?: unknown;
  actual?: unknown;
}

/** Evaluate an assertion against one immutable snapshot; no driver calls or retries occur here. */
export function evaluateSnapshotAssertion(snapshot: PlatformSnapshot, assertion: SnapshotAssertion): AssertionResult {
  try {
    const element = resolveSemanticSelector(snapshot, assertion.selector, { allowDisabled: true });
    const node = element.node;
    switch (assertion.kind) {
      case 'exists':
        return { passed: true, kind: assertion.kind, message: 'Element exists in the current snapshot.' };
      case 'visible': {
        const passed = node.visible !== false;
        return { passed, kind: assertion.kind, message: passed ? 'Element is visible.' : 'Element is not visible.', expected: true, actual: node.visible };
      }
      case 'enabled': {
        const passed = node.enabled !== false;
        return { passed, kind: assertion.kind, message: passed ? 'Element is enabled.' : 'Element is disabled.', expected: true, actual: node.enabled };
      }
      case 'textEquals': {
        const passed = (node.text ?? node.value ?? '') === assertion.expected;
        return { passed, kind: assertion.kind, message: passed ? 'Element text matches.' : 'Element text did not match.', expected: assertion.expected, actual: node.text ?? node.value ?? '' };
      }
      case 'textContains': {
        const actual = node.text ?? node.value ?? '';
        const passed = actual.includes(assertion.expected);
        return { passed, kind: assertion.kind, message: passed ? 'Element text contains expected content.' : 'Element text does not contain expected content.', expected: assertion.expected, actual };
      }
    }
  } catch (error) {
    if (error instanceof AutomationError && error.code === 'ELEMENT_NOT_FOUND' && assertion.kind !== 'exists') {
      return { passed: false, kind: assertion.kind, message: 'The selected element was not found in the current snapshot.' };
    }
    if (error instanceof AutomationError && error.code === 'ELEMENT_NOT_FOUND' && assertion.kind === 'exists') {
      return { passed: false, kind: assertion.kind, message: 'Expected element does not exist in the current snapshot.' };
    }
    throw error;
  }
}
