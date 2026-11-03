import { describe, expect, it } from 'vitest';
import { evaluateSnapshotAssertion } from '../assertions.js';
import type { PlatformSnapshot } from '../contracts.js';

const snapshot: PlatformSnapshot = {
  platform: 'android', targetId: 'emulator-5554', snapshotId: 's1', generation: 1,
  capturedAt: new Date(0).toISOString(),
  nodes: [{ ref: 'e1', text: 'Welcome back', label: 'Greeting', enabled: true, visible: true }]
};

describe('snapshot assertions', () => {
  it('checks visible text deterministically', () => {
    expect(evaluateSnapshotAssertion(snapshot, {
      kind: 'textContains', selector: { strategy: 'text', value: 'Welcome back' }, expected: 'Welcome'
    }).passed).toBe(true);
  });
  it('returns a failed result when a required node is absent', () => {
    expect(evaluateSnapshotAssertion(snapshot, {
      kind: 'exists', selector: { strategy: 'text', value: 'Missing' }
    }).passed).toBe(false);
  });
  it('does not treat disabled elements as absent', () => {
    const result = evaluateSnapshotAssertion({ ...snapshot, nodes: [{ ref: 'e2', text: 'Continue', enabled: false }] }, {
      kind: 'enabled', selector: { strategy: 'text', value: 'Continue' }
    });
    expect(result.passed).toBe(false);
  });
});
