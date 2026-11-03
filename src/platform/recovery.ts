import { AutomationError, type AutomationErrorCode } from './contracts.js';

export type FailureCategory =
  | 'selector' | 'stale_snapshot' | 'capability' | 'timeout' | 'cancelled'
  | 'connection' | 'action' | 'invalid_definition' | 'unknown';

export interface RecoverySuggestion {
  category: FailureCategory;
  summary: string;
  nextSteps: string[];
  safeToRetryObservation: boolean;
  retryActionAutomatically: false;
}

const mapping: Record<AutomationErrorCode, FailureCategory> = {
  DRIVER_UNAVAILABLE: 'connection',
  CONNECTION_FAILED: 'connection',
  SESSION_CLOSED: 'connection',
  UNSUPPORTED_CAPABILITY: 'capability',
  ELEMENT_NOT_FOUND: 'selector',
  AMBIGUOUS_SELECTOR: 'selector',
  STALE_SNAPSHOT: 'stale_snapshot',
  ELEMENT_DISABLED: 'selector',
  ACTION_TIMEOUT: 'timeout',
  ACTION_FAILED: 'action',
  CANCELLED: 'cancelled',
  INVALID_SPEC: 'invalid_definition'
};

/** Produces an advisory only. It never repeats an action or edits a saved test. */
export function suggestRecovery(error: unknown): RecoverySuggestion {
  const automationError = error instanceof AutomationError ? error : undefined;
  const category = automationError ? mapping[automationError.code] : 'unknown';
  const nextSteps: Record<FailureCategory, string[]> = {
    selector: ['Capture a fresh accessibility snapshot.', 'Check locator uniqueness and platform semantics.', 'Update the durable selector only after reviewing the new snapshot.'],
    stale_snapshot: ['Discard the runtime element reference.', 'Capture a new snapshot and resolve the semantic selector again.'],
    capability: ['Inspect the selected driver capability matrix.', 'Choose a supported action or provide a platform-specific adapter.'],
    timeout: ['Inspect loading state and network/app responsiveness.', 'Increase the wait only when the expected transition is valid.'],
    cancelled: ['Confirm the caller cancellation reason.', 'Start a new run only after the target state is known.'],
    connection: ['Run platform doctor/preflight checks.', 'Verify target availability, runtime versions and permissions.'],
    action: ['Preserve current evidence and inspect whether the action was dispatched.', 'Do not retry a potentially non-idempotent action without checking target state.'],
    invalid_definition: ['Validate the test definition against its declared schema version.', 'Correct the reported field without weakening validation.'],
    unknown: ['Capture logs, screenshot and a fresh accessibility snapshot.', 'Classify the failure before attempting recovery.']
  };
  return {
    category,
    summary: automationError ? automationError.message : (error instanceof Error ? error.message : String(error)),
    nextSteps: nextSteps[category],
    safeToRetryObservation: category === 'selector' || category === 'stale_snapshot' || category === 'timeout',
    retryActionAutomatically: false
  };
}
