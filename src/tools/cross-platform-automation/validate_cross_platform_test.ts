import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { parseAutomationTest } from '../../platform/specification.js';
import type { ToolModule } from '../types.js';

export const toolName = 'validate_cross_platform_test';
export const workflow = 'cross-platform-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Validate Cross-Platform Test',
    description: 'Validate a versioned cross-platform automation test definition without connecting to devices or browsers.',
    inputSchema: { testDefinition: z.unknown().describe('The complete schemaVersion 1.0 test definition as a JSON object.') },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, withErrorHandling(async (args: { testDefinition: unknown }) => {
    const definition = parseAutomationTest(args.testDefinition);
    const summary = {
      valid: true, schemaVersion: definition.schemaVersion, id: definition.id, name: definition.name,
      platforms: definition.platforms, stepCount: definition.steps.length, aiMode: definition.ai.mode,
      destructiveActionsAllowed: definition.policy.allowDestructiveActions
    };
    return textResult(JSON.stringify(summary, null, 2), summary);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
