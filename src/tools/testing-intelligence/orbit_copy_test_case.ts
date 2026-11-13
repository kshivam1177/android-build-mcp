import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';
import { CopyTestUseCase } from '../../testorbit/application/copy-test.js';
import { toTestId } from '../../testorbit/domain/types.js';

export const toolName = 'orbit_copy_test_case';
export const workflow = 'testing-intelligence';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Copy Test Case Across Platforms',
      description:
        'Copy a canonical JSON test case from one platform folder to another (TestOrbit C4). The flow copies; each step\'s elementId is re-resolved against the target platform\'s learned screens (stable-selector fields, then unique contentDesc, then className + sibling index — never raw text or list order). The target Maestro YAML is regenerated; the copy is marked "copied, unverified" until its first green run. Unmapped elements fail loudly naming the step.',
      inputSchema: {
        projectPath: z.string().optional().describe('Project root; defaults to cwd.'),
        testId: z.string().min(1).max(80).describe('Test case id to copy, e.g. "login-flow".'),
        fromPlatform: z.enum(['android', 'ios', 'flutter', 'web']).describe('Source platform.'),
        toPlatform: z.enum(['android', 'ios', 'flutter', 'web']).describe('Target platform.'),
        as: z.string().min(1).max(80).optional().describe('New test id on the target platform; defaults to the source id.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args) => {
      const projectRoot = path.resolve(args.projectPath ?? process.cwd());
      const result = new CopyTestUseCase().copy({
        projectRoot,
        fromPlatform: args.fromPlatform,
        toPlatform: args.toPlatform,
        testId: toTestId(args.testId),
        ...(args.as !== undefined ? { newTestId: toTestId(args.as) } : {}),
      });
      return textResult(
        `Copied test "${args.testId}" from ${args.fromPlatform} to ${args.toPlatform} as "${result.testCase.id}" (copied, unverified until its first green run). YAML at ${path.relative(projectRoot, result.yamlPath)}.`,
        {
          testId: result.testCase.id,
          fromPlatform: args.fromPlatform,
          toPlatform: args.toPlatform,
          verificationStatus: result.testCase.verificationStatus,
          testCasePath: path.relative(projectRoot, result.testCasePath),
          yamlPath: path.relative(projectRoot, result.yamlPath),
          envVars: [...result.envVars],
        },
      );
    }),
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
