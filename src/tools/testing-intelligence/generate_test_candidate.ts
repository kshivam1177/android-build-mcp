import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfigDir } from '../../config/loader.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { createTestCandidate } from '../../testing-intelligence/testCandidate.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'generate_test_candidate';
export const workflow = 'testing-intelligence';
const proposedStepSchema = z.object({
  action: z.enum(['tap', 'type_text', 'key_press', 'button', 'wait_for_ui']),
  target: z.string().max(500).optional(),
  text: z.string().max(2000).optional(),
  key: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  expectedOutcome: z.string().max(500).optional(),
});
export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Generate a Reviewable Test Candidate',
    description: 'Create a review-required TestOrbit test candidate from a natural-language request, explicit acceptance criteria, and optionally proposed UI steps from a coding agent that inspected the project. Candidate steps are not trusted or executable until reviewed. This does not claim to generate Google Android CLI Journey syntax.',
    inputSchema: {
      request: z.string().min(3).max(4000),
      acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(30),
      proposedSteps: z.array(proposedStepSchema).max(50).optional().describe('Optional candidate actions/selectors derived by the calling agent after inspecting the project. Review is still required.'),
      platform: z.enum(['android', 'flutter', 'cross-platform']).optional().default('android'),
      projectPath: z.string().optional(),
      save: z.boolean().optional().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: {
    request: string;
    acceptanceCriteria: string[];
    proposedSteps?: Array<{ action: 'tap' | 'type_text' | 'key_press' | 'button' | 'wait_for_ui'; target?: string; text?: string; key?: string; description?: string; expectedOutcome?: string }>;
    platform?: 'android' | 'flutter' | 'cross-platform';
    projectPath?: string;
    save?: boolean;
  }) => {
    const root = args.projectPath ? path.resolve(args.projectPath) : resolveProjectRoot(path.resolve(process.cwd()));
    const candidate = createTestCandidate({
      request: args.request,
      acceptanceCriteria: args.acceptanceCriteria,
      platform: args.platform ?? 'android',
      proposedSteps: args.proposedSteps,
    });
    if (args.save === false) return textResult(JSON.stringify(candidate, null, 2), { ...candidate });
    const dir = path.join(getConfigDir(root), 'generated-tests');
    await fs.mkdir(dir, { recursive: true });
    const base = candidate.id + '.json';
    let file = path.join(dir, base);
    let index = 1;
    while (true) {
      try { await fs.access(file); file = path.join(dir, candidate.id + '-' + index++ + '.json'); }
      catch { break; }
    }
    await fs.writeFile(file, JSON.stringify(candidate, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    const result = { ...candidate, savedTo: path.relative(root, file).split(path.sep).join('/') };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}
const mod: ToolModule = { toolName, workflow, register };
export default mod;
