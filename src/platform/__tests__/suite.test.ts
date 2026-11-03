import { describe, expect, it } from 'vitest';
import { evaluateCrossPlatformSuiteGate } from '../suite.js';

describe('cross-platform suite gate', () => {
  const provenance = { gitHeadSha: 'a'.repeat(40), workingTreeClean: true };
  it('passes only when every selected definition passes with clean commit provenance', () => {
    expect(evaluateCrossPlatformSuiteGate({ ...provenance, selectedCount: 2, outcomes: [
      { id: 'login', success: true, cancelled: false, timedOut: false, durationMs: 10 },
      { id: 'checkout', success: true, cancelled: false, timedOut: false, durationMs: 20 }
    ] }).decision).toBe('pass');
  });
  it('fails when a definition fails', () => {
    expect(evaluateCrossPlatformSuiteGate({ ...provenance, selectedCount: 1, outcomes: [
      { id: 'login', success: false, cancelled: false, timedOut: false, durationMs: 10 }
    ] }).decision).toBe('fail');
  });
  it('returns incomplete for missing, cancelled or timed-out definitions', () => {
    expect(evaluateCrossPlatformSuiteGate({ ...provenance, selectedCount: 2, outcomes: [
      { id: 'login', success: true, cancelled: false, timedOut: false, durationMs: 10 }
    ] }).decision).toBe('incomplete');
    expect(evaluateCrossPlatformSuiteGate({ ...provenance, selectedCount: 1, outcomes: [
      { id: 'login', success: false, cancelled: true, timedOut: false, durationMs: 10 }
    ] }).decision).toBe('incomplete');
    expect(evaluateCrossPlatformSuiteGate({ ...provenance, selectedCount: 1, outcomes: [
      { id: 'login', success: false, cancelled: false, timedOut: true, durationMs: 10 }
    ] }).decision).toBe('incomplete');
  });
  it('blocks passing outcomes without a current clean source revision', () => {
    const outcomes = [{ id: 'login', success: true, cancelled: false, timedOut: false, durationMs: 10 }];
    expect(evaluateCrossPlatformSuiteGate({ selectedCount: 1, outcomes, gitHeadSha: null, workingTreeClean: true }).decision).toBe('incomplete');
    expect(evaluateCrossPlatformSuiteGate({ selectedCount: 1, outcomes, gitHeadSha: 'a'.repeat(40), workingTreeClean: false }).decision).toBe('incomplete');
  });
});
