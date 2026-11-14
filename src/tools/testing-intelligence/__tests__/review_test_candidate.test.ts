import { describe, expect, it } from 'vitest';
import { toApprovedTestCase, validateCandidateForApproval } from '../review_test_candidate.js';

const validCandidate = {
  schemaVersion: 1,
  format: 'testorbit-test-candidate',
  id: 'candidate-login',
  title: 'Verify login',
  platform: 'android',
  request: 'Verify login succeeds',
  reviewRequired: true,
  executable: false,
  acceptanceCriteria: ['Home screen is visible'],
  steps: [{
    action: 'tap',
    target: 'Sign in',
    description: 'Tap the Sign in button',
    expectedOutcome: 'Login form is displayed',
  }],
};

describe('review_test_candidate validation', () => {
  it('accepts a concrete reviewed candidate without claiming device selector verification', () => {
    expect(validateCandidateForApproval(validCandidate)).toEqual({ valid: true, issues: [] });
  });

  it('rejects placeholder steps and missing targets/outcomes', () => {
    const result = validateCandidateForApproval({
      ...validCandidate,
      steps: [{ action: 'tap', description: 'Review and define the UI interaction', reviewRequired: true }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'placeholder', 'target-required', 'outcome-required', 'review-pending',
    ]));
  });

  it('rejects malformed candidate formats and missing acceptance criteria', () => {
    expect(validateCandidateForApproval({ ...validCandidate, format: 'other' }).valid).toBe(false);
    expect(validateCandidateForApproval({ ...validCandidate, acceptanceCriteria: [] }).valid).toBe(false);
  });

  it('promotes the candidate shape without retaining the review-only marker', () => {
    const parsed = { ...validCandidate, steps: validCandidate.steps.map(step => ({ ...step, reviewRequired: true as const })) };
    const promoted = toApprovedTestCase(parsed as never, ['src/Login.kt']);
    expect(promoted.relatedFiles).toEqual(['src/Login.kt']);
    expect(promoted.steps[0]).not.toHaveProperty('reviewRequired');
    expect(promoted.assertions).toEqual(['Home screen is visible']);
    expect(promoted.provenance.approvalRequired).toBe(true);
  });
});
