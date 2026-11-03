import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { inspectPlatformReadiness } from '../../platform/preflight.js';
import type { PlatformKind } from '../../platform/contracts.js';
import type { ToolModule } from '../types.js';

export const toolName = 'check_cross_platform_runtime';
export const workflow = 'cross-platform-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Check Cross-Platform Runtime',
    description: 'Run read-only preflight checks for Android, Flutter, iOS and Web automation prerequisites. Does not install software, boot devices, or launch apps.',
    inputSchema: {
      platforms: z.array(z.enum(['android', 'flutter', 'ios', 'web'])).min(1).max(4),
      flutterOsPlatform: z.enum(['android', 'ios']).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, withErrorHandling(async (args: { platforms: PlatformKind[]; flutterOsPlatform?: 'android' | 'ios' }) => {
    const result = await inspectPlatformReadiness(args.platforms, { flutterOsPlatform: args.flutterOsPlatform });
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
