import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import {
  getWorkflowNames,
  getToolNamesForWorkflow,
  getHandle,
  isWorkflowEnabled,
  markWorkflowEnabled,
  markWorkflowDisabled,
} from '../../mcp/toolRegistry.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'manage_workflows';
export const workflow = 'workflow-discovery';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Manage Workflows',
      description:
        'List every workflow and which of its tools are currently enabled, or enable/disable a workflow for this running server session. Session-only - it does not edit .android-build-mcp/config.yaml, so restart-persistent changes still belong in enabledWorkflows there.',
      inputSchema: {
        action: z.enum(['list', 'enable', 'disable']).optional().describe('Default "list".'),
        workflowName: z.string().optional().describe('Required for enable/disable.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withErrorHandling(async (args: { action?: 'list' | 'enable' | 'disable'; workflowName?: string }) => {
      const action = args.action ?? 'list';

      if (action === 'list') {
        const workflows = getWorkflowNames().map((name) => ({
          name,
          enabled: isWorkflowEnabled(name),
          tools: getToolNamesForWorkflow(name),
        }));
        return textResult(JSON.stringify(workflows, null, 2), { workflows });
      }

      if (!args.workflowName) {
        throw new TestOrbitFrameworkError('INVALID_CONFIG', 'workflowName is required for enable/disable.');
      }
      const toolNames = getToolNamesForWorkflow(args.workflowName);
      if (toolNames.length === 0) {
        throw new TestOrbitFrameworkError(
          'WORKFLOW_NOT_FOUND',
          `No workflow named "${args.workflowName}". Known workflows: ${getWorkflowNames().join(', ')}`
        );
      }

      for (const name of toolNames) {
        const handle = getHandle(name);
        if (!handle) continue;
        if (action === 'enable') handle.enable();
        else handle.disable();
      }
      if (action === 'enable') markWorkflowEnabled(args.workflowName);
      else markWorkflowDisabled(args.workflowName);

      return textResult(`${action === 'enable' ? 'Enabled' : 'Disabled'} workflow "${args.workflowName}" (${toolNames.length} tools) for this session.`, {
        workflowName: args.workflowName,
        action,
        tools: toolNames,
      });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
