import type { PlatformKind } from './contracts.js';

export type CrossPlatformSuiteDecision = 'pass' | 'fail' | 'incomplete';

export interface CrossPlatformSuiteOutcome {
  id: string;
  success: boolean;
  cancelled: boolean;
  timedOut: boolean;
  durationMs: number;
}

export function evaluateCrossPlatformSuiteGate(input: {
  outcomes: CrossPlatformSuiteOutcome[];
  gitHeadSha: string | null;
  workingTreeClean: boolean | null;
  selectedCount: number;
  definitionManifestSha256: string | null;
  definitionsUnchanged: boolean | null;
}): { decision: CrossPlatformSuiteDecision; reason: string; passed: number; failed: number; incomplete: number; total: number } {
  const passed = input.outcomes.filter((outcome) => outcome.success && !outcome.cancelled && !outcome.timedOut).length;
  const failed = input.outcomes.filter((outcome) => !outcome.success && !outcome.cancelled && !outcome.timedOut).length;
  const incomplete = input.outcomes.length - passed - failed;
  if (failed > 0) return { decision: 'fail', reason: 'At least one cross-platform test definition failed.', passed, failed, incomplete, total: input.selectedCount };
  if (input.selectedCount === 0) return { decision: 'incomplete', reason: 'No cross-platform test definitions were selected.', passed, failed, incomplete, total: 0 };
  if (input.outcomes.length !== input.selectedCount || incomplete > 0) return { decision: 'incomplete', reason: 'Some selected definitions did not complete with an explicit passing result.', passed, failed, incomplete: incomplete + Math.max(0, input.selectedCount - input.outcomes.length), total: input.selectedCount };
  if (!input.gitHeadSha) return { decision: 'incomplete', reason: 'Git HEAD provenance is unavailable; results cannot be bound to a source revision.', passed, failed, incomplete, total: input.selectedCount };
  if (input.workingTreeClean !== true) return { decision: 'incomplete', reason: 'The working tree is dirty or unverifiable; commit SHA alone cannot identify the tested content.', passed, failed, incomplete, total: input.selectedCount };
  if (!input.definitionManifestSha256 || !/^[a-f0-9]{64}$/i.test(input.definitionManifestSha256)) return { decision: 'incomplete', reason: 'Selected test definition content is not cryptographically identified.', passed, failed, incomplete, total: input.selectedCount };
  if (input.definitionsUnchanged !== true) return { decision: 'incomplete', reason: 'One or more selected test definitions changed or disappeared during execution.', passed, failed, incomplete, total: input.selectedCount };
  return { decision: 'pass', reason: 'Every selected definition passed; source revision and exact test-definition content are bound to the report.', passed, failed, incomplete, total: input.selectedCount };
}

export function uniquePlatforms(platforms: PlatformKind[]): PlatformKind[] {
  return [...new Set(platforms)];
}
