import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FileDeviceFleet } from '../../platform/fleet.js';
import { createPlatformDrivers } from '../../platform/drivers.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { PlatformKind } from '../../platform/contracts.js';
import type { ToolModule } from '../types.js';

export const toolName = 'manage_cross_platform_fleet';
export const workflow = 'cross-platform-automation';

const targetInput = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  platform: z.enum(['android', 'flutter', 'ios', 'web']),
  targetId: z.string().min(1).max(256).optional(),
  appId: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+$/).optional(),
  baseUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.union([z.string().max(2048), z.number(), z.boolean()])).optional(),
  labels: z.array(z.string().min(1).max(64)).max(30).optional(),
  enabled: z.boolean().optional()
});

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Manage Cross-Platform Device Fleet',
    description: 'Maintain a project-local registry of Android, Flutter, iOS and Web targets; inspect target health, and acquire/release exclusive time-limited leases so parallel agents cannot claim the same target. This registers existing runtimes only; it does not provision cloud devices or install platform tooling.',
    inputSchema: {
      action: z.enum(['list', 'register', 'remove', 'health', 'lease', 'release']),
      projectPath: z.string().optional(),
      target: targetInput.optional(),
      targetId: z.string().min(1).max(100).optional(),
      leaseToken: z.string().uuid().optional(),
      owner: z.string().min(1).max(128).optional(),
      ttlSeconds: z.number().int().min(30).max(3600).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, withErrorHandling(async (args: {
    action: 'list' | 'register' | 'remove' | 'health' | 'lease' | 'release';
    projectPath?: string; target?: z.infer<typeof targetInput>; targetId?: string;
    leaseToken?: string; owner?: string; ttlSeconds?: number;
  }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const fleet = new FileDeviceFleet(root);
    if (args.action === 'list') {
      const [targets, leases] = await Promise.all([fleet.list(), fleet.activeLeases()]);
      const result = { targets, leases, availableCount: targets.filter((target) => target.enabled && !leases.some((lease) => lease.targetId === target.id)).length };
      return textResult(JSON.stringify(result, null, 2), result);
    }
    if (args.action === 'register') {
      if (!args.target) throw new Error('target is required for register.');
      const result = await fleet.register({ ...args.target, labels: args.target.labels ?? [], enabled: args.target.enabled ?? true });
      return textResult(JSON.stringify({ registered: result }, null, 2), { registered: result });
    }
    if (args.action === 'remove') {
      if (!args.targetId) throw new Error('targetId is required for remove.');
      await fleet.remove(args.targetId);
      return textResult('Removed fleet target ' + args.targetId + '.', { removed: args.targetId });
    }
    if (args.action === 'lease') {
      if (!args.targetId || !args.owner) throw new Error('targetId and owner are required for lease.');
      const lease = await fleet.acquire(args.targetId, args.owner, args.ttlSeconds);
      return textResult(JSON.stringify({ lease }, null, 2), { lease });
    }
    if (args.action === 'release') {
      if (!args.leaseToken) throw new Error('leaseToken is required for release.');
      const released = await fleet.release(args.leaseToken);
      return textResult(JSON.stringify({ released }, null, 2), { released });
    }
    if (args.action === 'health') {
      const targets = await fleet.list();
      const selected = args.targetId ? targets.filter((target) => target.id === args.targetId) : targets.filter((target) => target.enabled);
      if (args.targetId && selected.length === 0) throw new Error('Fleet target not found: ' + args.targetId);
      const drivers = createPlatformDrivers();
      const checks = [];
      for (const target of selected) {
        const driver = drivers[target.platform as PlatformKind];
        let connected = false;
        try {
          const session = await driver.connect(fleet.driverConfig(target));
          connected = true;
          const capabilities = await driver.capabilities();
          checks.push({ id: target.id, platform: target.platform, healthy: true, sessionTargetId: session.targetId, capabilities });
        } catch (error) {
          checks.push({ id: target.id, platform: target.platform, healthy: false, error: error instanceof Error ? error.message : String(error) });
        } finally {
          if (connected) {
            try { await driver.disconnect(); }
            catch (error) { checks.push({ id: target.id, platform: target.platform, healthy: false, cleanupError: error instanceof Error ? error.message : String(error) }); }
          }
        }
      }
      const result = { checked: checks.length, healthy: checks.filter((item) => item.healthy).length, unhealthy: checks.filter((item) => !item.healthy).length, checks };
      return textResult(JSON.stringify(result, null, 2), result);
    }
    throw new Error('Unsupported fleet action.');
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
