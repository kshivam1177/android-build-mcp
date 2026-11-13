import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runUiWorkflow } from '../../automation/uiWorkflow.js';
import { resolveTarget } from '../../utils/adb.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'run_ui_workflow';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Run UI Workflow',
      description: 'Validate and execute a reusable JSON UI workflow from .testorbit/workflows or replay a successfully cached sequence from .testorbit/action-sequences. Successful runs are saved as reusable action sequences with timings; screen definitions live under .testorbit/screens and reports under .testorbit/test-reports.',
      inputSchema: {
        workflowFile: z.string().min(1).max(200).describe('Relative JSON file path inside .testorbit/workflows, or action-sequences/<workflow-id>.json to replay a previously successful sequence.'),
        projectPath: z.string().optional().describe('Android project root; defaults to current working directory.'),
        deviceId: z.string().optional().describe('Optional device serial passed to Android CLI.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: { workflowFile: string; projectPath?: string; deviceId?: string }) => {
      const target = await resolveTarget({ requestedId: args.deviceId });
      const result = await runUiWorkflow({ cwd: args.projectPath ?? process.cwd(), workflowFile: args.workflowFile, deviceId: target.id });
      return textResult(JSON.stringify(result, null, 2), result as unknown as Record<string, unknown>);
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
