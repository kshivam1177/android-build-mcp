import { describe, expect, it } from 'vitest';
import { AutomationError, type PlatformSnapshot } from '../contracts.js';
import { assertFreshReference, resolveSemanticSelector } from '../selectors.js';
import { parseAutomationTest } from '../specification.js';

const snapshot: PlatformSnapshot = {
  platform: 'android', targetId: 'emulator-5554', snapshotId: 'snap-1',
  generation: 3, capturedAt: new Date(0).toISOString(),
  nodes: [
    { ref: 'e1', text: 'Sign in', role: 'button', enabled: true },
    { ref: 'e2', text: 'Email', role: 'textbox', resourceId: 'com.demo:id/email', enabled: true }
  ]
};

describe('cross-platform semantic selectors', () => {
  it('resolves a unique durable selector and records snapshot provenance', () => {
    const result = resolveSemanticSelector(snapshot, { strategy: 'resourceId', value: 'com.demo:id/email' });
    expect(result.ref).toBe('e2');
    expect(result.generation).toBe(3);
    expect(result.snapshotId).toBe('snap-1');
  });

  it('fails closed for ambiguous selectors', () => {
    const ambiguous = { ...snapshot, nodes: [...snapshot.nodes, { ref: 'e3', text: 'Sign in', enabled: true }] };
    expect(() => resolveSemanticSelector(ambiguous, { strategy: 'text', value: 'Sign in' }))
      .toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_SELECTOR' }));
  });

  it('rejects stale runtime references', () => {
    const element = resolveSemanticSelector(snapshot, { strategy: 'text', value: 'Sign in' });
    expect(() => assertFreshReference({ ...snapshot, generation: 4 }, element))
      .toThrowError(expect.objectContaining({ code: 'STALE_SNAPSHOT' }));
  });

  it('rejects disabled elements', () => {
    const disabled = { ...snapshot, nodes: [{ ref: 'e1', text: 'Continue', enabled: false }] };
    expect(() => resolveSemanticSelector(disabled, { strategy: 'text', value: 'Continue' }))
      .toThrowError(expect.objectContaining({ code: 'ELEMENT_DISABLED' }));
  });
});

describe('versioned automation specification', () => {
  it('accepts a portable test definition', () => {
    const parsed = parseAutomationTest({
      schemaVersion: '1.0', id: 'login-smoke', name: 'Login smoke',
      platforms: ['android', 'ios', 'web'],
      steps: [{ id: 'enter-email', type: 'type', selector: { strategy: 'accessibilityId', value: 'email' }, value: 'qa@example.test' }]
    });
    expect(parsed.ai.mode).toBe('assisted');
    expect(parsed.policy.allowDestructiveActions).toBe(false);
  });

  it('rejects duplicate step ids', () => {
    expect(() => parseAutomationTest({
      schemaVersion: '1.0', id: 'duplicate', name: 'Duplicate',
      platforms: ['android'],
      steps: [{ id: 'same', type: 'back' }, { id: 'same', type: 'wait' }]
    })).toThrow();
  });
});
