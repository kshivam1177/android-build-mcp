import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { createPlatformDrivers } from '../../platform/drivers.js';
import { classifyUiState } from '../../platform/state.js';
import type { DriverConfig, PlatformKind } from '../../platform/contracts.js';
import type { ToolModule } from '../types.js';

export const toolName = 'inspect_cross_platform_target';
export const workflow = 'cross-platform-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Inspect Cross-Platform Target',
    description: 'Connect to one configured platform target, report driver capabilities, capture an accessibility snapshot and classify the observed UI state. Does not perform UI actions.',
    inputSchema: {
      platform: z.enum(['android', 'flutter', 'ios', 'web']),
      targetId: z.string().optional(),
      appId: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+$/).optional(),
      baseUrl: z.string().url().optional(),
      metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, withErrorHandling(async (args: { platform: PlatformKind; targetId?: string; appId?: string; baseUrl?: string; metadata?: Record<string, string | number | boolean> }) => {
    const driver = createPlatformDrivers()[args.platform];
    const config: DriverConfig = { platform: args.platform, ...(args.targetId ? { targetId: args.targetId } : {}), ...(args.appId ? { appId: args.appId } : {}), ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}), ...(args.metadata ? { metadata: args.metadata } : {}) };
    let connected = false;
    try {
      const session = await driver.connect(config);
      connected = true;
      const capabilities = await driver.capabilities();
      const snapshot = await driver.snapshot();
      const state = classifyUiState(snapshot);
      const result = {
        platform: args.platform,
        session: { id: session.id, targetId: session.targetId, connectedAt: session.connectedAt },
        capabilities,
        state,
        snapshot: {
          snapshotId: snapshot.snapshotId,
          generation: snapshot.generation,
          capturedAt: snapshot.capturedAt,
          nodeCount: snapshot.nodes.length,
          visibleNodeCount: snapshot.nodes.filter((node) => node.visible !== false).length,
          nodes: snapshot.nodes.slice(0, 250).map((node) => ({
            ref: node.ref, role: node.role, text: node.text, label: node.label,
            resourceId: node.resourceId, testId: node.testId, enabled: node.enabled, visible: node.visible
          }))
        }
      };
      return textResult(JSON.stringify(result, null, 2), result);
    } finally {
      if (connected) await driver.disconnect();
    }
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
