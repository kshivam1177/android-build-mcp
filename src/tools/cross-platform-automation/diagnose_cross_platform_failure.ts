import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { AutomationError } from '../../platform/contracts.js';
import { suggestRecovery } from '../../platform/recovery.js';
import type { ToolModule } from '../types.js';

export const toolName = 'diagnose_cross_platform_failure';
export const workflow = 'cross-platform-automation';

const errorCodes = ['DRIVER_UNAVAILABLE', 'CONNECTION_FAILED', 'SESSION_CLOSED', 'UNSUPPORTED_CAPABILITY', 'ELEMENT_NOT_FOUND', 'AMBIGUOUS_SELECTOR', 'STALE_SNAPSHOT', 'ELEMENT_DISABLED', 'ACTION_TIMEOUT', 'ACTION_FAILED', 'CANCELLED', 'INVALID_SPEC'] as const;

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Diagnose Cross-Platform Failure',
    description: 'Classify a cross-platform automation failure and return bounded, non-executing recovery advice. Never retries or edits a test definition.',
    inputSchema: {
      code: z.enum(errorCodes).optional(),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, withErrorHandling(async (args: { code?: typeof errorCodes[number]; message: string; details?: Record<string, unknown> }) => {
    const error = args.code ? new AutomationError(args.code, args.message, args.details) : new Error(args.message);
    const advice = suggestRecovery(error);
    const result = { ...advice, suppliedCode: args.code ?? 'UNCLASSIFIED', automaticActionTaken: false };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
