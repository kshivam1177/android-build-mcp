import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { listIosSimulators, setIosSimulatorState } from '../../platform/ios/simulator.js';
import type { ToolModule } from '../types.js';

export const toolName = 'manage_ios_simulator';
export const workflow = 'cross-platform-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Manage iOS Simulator',
    description: 'List available iOS simulators or explicitly boot/shut down a selected simulator. Requires macOS and Xcode. Does not erase simulator data.',
    inputSchema: {
      action: z.enum(['list', 'boot', 'shutdown']),
      udid: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/).optional().describe('Required for boot and shutdown; use a UDID returned by list.')
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  }, withErrorHandling(async (args: { action: 'list' | 'boot' | 'shutdown'; udid?: string }) => {
    if (args.action === 'list') {
      const simulators = await listIosSimulators();
      const result = { action: 'list', count: simulators.length, simulators };
      return textResult(JSON.stringify(result, null, 2), result);
    }
    if (!args.udid) throw new Error('A simulator UDID is required for boot and shutdown.');
    const result = await setIosSimulatorState(args.udid, args.action);
    return textResult(JSON.stringify(result, null, 2), { ...result });
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
