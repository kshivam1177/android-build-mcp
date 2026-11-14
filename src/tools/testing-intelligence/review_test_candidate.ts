import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfigDir } from '../../config/loader.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'review_test_candidate';
export const workflow = 'testing-intelligence';

const CandidateStep = z.object({
  action: z.enum(['tap', 'type_text', 'key_press', 'button', 'wait_for_ui']),
  target: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  description: z.string().optional(),
  expectedOutcome: z.string().optional(),
  reviewRequired: z.literal(true).optional(),
});
const CandidateSchema = z.object({
  schemaVersion: z.literal(1),
  format: z.literal('testorbit-test-candidate'),
  id: z.string().min(1),
  title: z.string().min(1),
  platform: z.enum(['android', 'flutter', 'cross-platform']),
  request: z.string().min(3),
  reviewRequired: z.literal(true),
  executable: z.literal(false),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  steps: z.array(CandidateStep).min(1),
  notes: z.array(z.string()).optional(),
});
export type CandidateIssue = { code: string; step?: number; message: string };
export function validateCandidateForApproval(candidate: unknown): { valid: boolean; issues: CandidateIssue[] } {
  const parsed = CandidateSchema.safeParse(candidate);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map(issue => ({ code: 'schema', message: issue.path.join('.') + ': ' + issue.message })) };
  const issues: CandidateIssue[] = [];
  parsed.data.steps.forEach((step, index) => {
    const number = index + 1;
    const description = step.description?.trim() ?? '';
    if (/placeholder|review and define|review proposed step|todo|tbd/i.test(description)) issues.push({ code: 'placeholder', step: number, message: 'Replace placeholder step description with a concrete, reviewed action.' });
    if ((step.action === 'tap' || step.action === 'type_text') && !step.target?.trim()) issues.push({ code: 'target-required', step: number, message: step.action + ' requires a concrete target selector or text.' });
    if (step.action === 'type_text' && !step.text?.length) issues.push({ code: 'text-required', step: number, message: 'type_text requires explicit text input.' });
    if ((step.action === 'key_press' || step.action === 'button') && !step.key?.trim()) issues.push({ code: 'key-required', step: number, message: step.action + ' requires an explicit key.' });
    if (!step.expectedOutcome?.trim()) issues.push({ code: 'outcome-required', step: number, message: 'Every approved step must state an expected outcome.' });
    if (step.reviewRequired === true) issues.push({ code: 'review-pending', step: number, message: 'Step is still marked as requiring review.' });
  });
  if (parsed.data.acceptanceCriteria.some(item => !item.trim())) issues.push({ code: 'empty-criterion', message: 'Acceptance criteria cannot be empty.' });
  return { valid: issues.length === 0, issues };
}

export function toApprovedTestCase(candidate: z.infer<typeof CandidateSchema>, relatedFiles: string[]) {
  return {
    id: candidate.id,
    title: candidate.title,
    description: candidate.request,
    category: 'reviewed-generated',
    platform: candidate.platform,
    relatedFiles: [...new Set(relatedFiles.map(value => value.trim()).filter(Boolean))],
    prerequisites: [],
    steps: candidate.steps.map(({ reviewRequired: _reviewRequired, ...step }, index) => ({
      stepNumber: index + 1,
      ...step,
      action: step.action,
    })),
    assertions: candidate.acceptanceCriteria,
    provenance: { format: candidate.format, candidateId: candidate.id, approvedAt: new Date().toISOString(), approvalRequired: true },
  };
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Review and Approve a Generated Test Candidate',
    description: 'Validate a saved generated test candidate and optionally promote it into the approved test-case directory. Approval is explicit; placeholders, unreviewed steps, missing targets, inputs, outcomes, or malformed candidate schemas block promotion. This tool does not execute tests or claim selectors were verified on a device.',
    inputSchema: {
      projectPath: z.string().optional(),
      candidateId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).describe('Candidate filename stem under .testorbit/generated-tests; path traversal is not accepted.'),
      approve: z.boolean().optional().default(false).describe('Must be true to promote a valid candidate into testcases.'),
      relatedFiles: z.array(z.string().min(1).max(500)).max(100).optional().default([]).describe('Optional source paths explicitly reviewed by the caller; not inferred automatically.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; candidateId: string; approve?: boolean; relatedFiles?: string[] }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const config = getConfigDir(root);
    const candidatePath = path.join(config, 'generated-tests', args.candidateId + '.json');
    const raw = await fs.readFile(candidatePath, 'utf8');
    let candidate: unknown;
    try { candidate = JSON.parse(raw); } catch { throw new Error('Candidate file is not valid JSON: ' + args.candidateId); }
    const validation = validateCandidateForApproval(candidate);
    if (!validation.valid) {
      return textResult(JSON.stringify({ status: 'needs-review', approved: false, candidateId: args.candidateId, issues: validation.issues, promotionAllowed: false }, null, 2), { status: 'needs-review', approved: false, issues: validation.issues, promotionAllowed: false });
    }
    if (!args.approve) {
      return textResult(JSON.stringify({ status: 'valid-awaiting-explicit-approval', approved: false, candidateId: args.candidateId, promotionAllowed: true, note: 'Validation passed, but no test case was written. Call again with approve=true after reviewing selectors and behavior on the target project.' }, null, 2), { status: 'valid-awaiting-explicit-approval', approved: false, candidateId: args.candidateId, promotionAllowed: true });
    }
    const parsed = CandidateSchema.parse(candidate);
    const testCase = toApprovedTestCase(parsed, args.relatedFiles ?? []);
    const targetDir = path.join(config, 'testcases');
    await fs.mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, args.candidateId + '.json');
    try { await fs.access(target); throw new Error('Refusing to overwrite an existing saved test case: ' + path.relative(root, target)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await fs.writeFile(target, JSON.stringify(testCase, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return textResult(JSON.stringify({ status: 'approved', approved: true, candidateId: args.candidateId, savedTo: path.relative(root, target).split(path.sep).join('/'), execution: 'not-executed', note: 'The test case was promoted only after explicit approval. Run through run_unified_test_run to execute it; no execution or coverage is claimed here.' }, null, 2), { status: 'approved', approved: true, savedTo: path.relative(root, target).split(path.sep).join('/'), execution: 'not-executed' });
  }));
}
const mod: ToolModule = { toolName, workflow, register };
export default mod;
