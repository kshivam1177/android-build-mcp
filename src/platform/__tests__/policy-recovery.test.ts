import { describe, expect, it } from 'vitest';
import { evaluateActionPolicy } from '../policy.js';
import { suggestRecovery } from '../recovery.js';
import { AutomationError } from '../contracts.js';

describe('execution policy', () => {
  const action = { type: 'tap', selector: { strategy: 'text' as const, value: 'Confirm' } } as const;
  it('blocks destructive intent unless explicitly allowed', () => {
    expect(evaluateActionPolicy({ action, risk: 'destructive', reason: 'Delete record' }, { allowDestructiveActions: false }).allowed).toBe(false);
  });
  it('requires approval for configured writes', () => {
    expect(evaluateActionPolicy({ action, risk: 'write', reason: 'Save form' }, { allowDestructiveActions: false, requireApprovalForWrites: true }).requiresApproval).toBe(true);
  });
});

describe('recovery advisor', () => {
  it('never recommends automatic action retries', () => {
    const result = suggestRecovery(new AutomationError('ACTION_FAILED', 'Tap command timed out.'));
    expect(result.retryActionAutomatically).toBe(false);
    expect(result.category).toBe('action');
  });
});
