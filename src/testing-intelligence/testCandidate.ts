export type CandidateAction = 'tap' | 'type_text' | 'key_press' | 'button' | 'wait_for_ui';
export interface ProposedTestStep {
  action: CandidateAction;
  target?: string;
  text?: string;
  key?: string;
  description?: string;
  expectedOutcome?: string;
}
export interface TestCandidateInput {
  request: string;
  acceptanceCriteria: string[];
  platform: 'android' | 'flutter' | 'cross-platform';
  proposedSteps?: ProposedTestStep[];
}
export interface TestCandidate {
  schemaVersion: 1;
  format: 'testorbit-test-candidate';
  id: string;
  title: string;
  platform: TestCandidateInput['platform'];
  request: string;
  reviewRequired: true;
  executable: false;
  acceptanceCriteria: string[];
  steps: Array<ProposedTestStep & { description: string; reviewRequired: true }>;
  notes: string[];
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'candidate';
}
function validateSteps(steps: ProposedTestStep[]): void {
  if (steps.length > 50) throw new Error('At most 50 proposed steps are supported per candidate.');
  steps.forEach((step, index) => {
    if (!['tap', 'type_text', 'key_press', 'button', 'wait_for_ui'].includes(step.action)) throw new Error('Unsupported proposed action at step ' + (index + 1) + '.');
    if ((step.action === 'tap' || step.action === 'type_text') && !(step.target?.trim() || step.description?.trim())) {
      throw new Error('Proposed step ' + (index + 1) + ' needs a target or description.');
    }
    if (step.action === 'type_text' && !step.text) throw new Error('Proposed type_text step ' + (index + 1) + ' needs text.');
    if ((step.action === 'key_press' || step.action === 'button') && !step.key) throw new Error('Proposed key_press/button step ' + (index + 1) + ' needs a key.');
  });
}
export function createTestCandidate(input: TestCandidateInput): TestCandidate {
  const request = input.request.trim();
  if (request.length < 3) throw new Error('Request must contain at least 3 characters.');
  const criteria = input.acceptanceCriteria.map(item => item.trim()).filter(Boolean);
  if (criteria.length === 0) throw new Error('Provide at least one explicit acceptance criterion; the generator does not invent expected behavior.');
  if (criteria.length > 30) throw new Error('At most 30 acceptance criteria are supported per candidate.');
  const proposed = input.proposedSteps ?? [];
  validateSteps(proposed);
  const steps = proposed.length
    ? proposed.map((step, index) => ({
        ...step,
        description: step.description?.trim() || 'Review proposed step ' + (index + 1),
        ...(step.expectedOutcome ? { expectedOutcome: step.expectedOutcome.trim() } : {}),
        reviewRequired: true as const,
      }))
    : criteria.map((criterion, index) => ({
        action: 'wait_for_ui' as const,
        description: 'Review and define the UI interaction for acceptance criterion ' + (index + 1),
        expectedOutcome: criterion,
        reviewRequired: true as const,
      }));
  return {
    schemaVersion: 1, format: 'testorbit-test-candidate', id: 'candidate-' + slug(request),
    title: request.slice(0, 120), platform: input.platform, request,
    reviewRequired: true, executable: false, acceptanceCriteria: criteria, steps,
    notes: [
      proposed.length
        ? 'Proposed steps were supplied by the caller and are still unverified; review selectors, actions, and assertions against the source project before saving as an executable test case.'
        : 'No proposed interactions were supplied, so the steps are placeholders rather than an executable test script.',
      'This candidate is intentionally non-executable until a human reviews and saves it as a test case.',
      'This format is TestOrbit review-candidate JSON, not Google Android CLI Journey syntax.',
    ],
  };
}
