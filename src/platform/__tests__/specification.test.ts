import { describe, expect, it } from 'vitest';
import { parseAutomationTest } from '../specification.js';

describe('cross-platform test schema', () => {
  it('accepts deterministic snapshot assertions', () => {
    const parsed = parseAutomationTest({
      schemaVersion: '1.0', id: 'assertion-spec', name: 'Assertion spec', platforms: ['android'],
      steps: [{ id: 'home', type: 'assert', assertion: { kind: 'visible', selector: { strategy: 'text', value: 'Home' } } }]
    });
    expect(parsed.steps[0]?.type).toBe('assert');
  });

  it('accepts explicit keyboard and app lifecycle actions', () => {
    const parsed = parseAutomationTest({
      schemaVersion: '1.0', id: 'lifecycle', name: 'Lifecycle', platforms: ['android', 'ios'],
      steps: [
        { id: 'dismiss-keyboard', type: 'hideKeyboard' },
        { id: 'launch', type: 'launchApp' },
        { id: 'stop', type: 'terminateApp', appId: 'com.example.app' }
      ]
    });
    expect(parsed.steps.map((step) => step.type)).toEqual(['hideKeyboard', 'launchApp', 'terminateApp']);
    expect(() => parseAutomationTest({
      schemaVersion: '1.0', id: 'bad-lifecycle', name: 'Bad lifecycle', platforms: ['android'],
      steps: [{ id: 'launch', type: 'launchApp', appId: '   ' }]
    })).toThrow();
  });

  it('rejects duplicate step identifiers', () => {
    expect(() => parseAutomationTest({
      schemaVersion: '1.0', id: 'duplicate-step', name: 'Duplicate', platforms: ['web'],
      steps: [
        { id: 'same', type: 'wait', timeoutMs: 1 },
        { id: 'same', type: 'wait', timeoutMs: 2 }
      ]
    })).toThrow(/unique/);
  });
});
