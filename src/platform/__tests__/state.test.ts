import { describe, expect, it } from 'vitest';
import { classifyUiState } from '../state.js';
import type { PlatformSnapshot } from '../contracts.js';

function snap(text: string): PlatformSnapshot {
  return { platform: 'web', targetId: 'browser', snapshotId: 's', generation: 1, capturedAt: new Date(0).toISOString(), nodes: [{ ref: 'e1', text, visible: true }] };
}

describe('UI state classifier', () => {
  it('classifies explicit error state before success signals', () => {
    expect(classifyUiState(snap('Saved, but an error occurred')).state).toBe('error');
  });
  it('classifies authentication screens', () => {
    expect(classifyUiState(snap('Enter password to sign in')).state).toBe('authentication');
  });
  it('classifies native permission prompts without approving them', () => {
    expect(classifyUiState(snap('Allow this app to access your location while using the app')).state).toBe('permission');
  });
  it('keeps unknown screens as unexpected', () => {
    expect(classifyUiState(snap('Welcome')).state).toBe('unexpected');
  });
});
