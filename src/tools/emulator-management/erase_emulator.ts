import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { listTargets, runAdbForTarget } from '../../utils/adb.js';
import { startBackgroundProcess } from '../../utils/processRegistry.js';
import { findEmulatorBinary, waitForNewEmulator } from './_shared.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'erase_emulator';
export const workflow = 'emulator-management';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Erase Emulator (Wipe Data)',
      description:
        'Wipe an AVD back to a factory-fresh state. If it\'s currently running, kills it first, then reboots with -wipe-data and waits for "device" state.',
      inputSchema: {
        avdName: z.string(),
        headless: z.boolean().optional(),
        timeoutMs: z.number().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: { avdName: string; headless?: boolean; timeoutMs?: number }) => {
      const before = await listTargets();
      const running = before.find((t) => t.type === 'emulator' && t.avdName === args.avdName);
      if (running) {
        try {
          await runAdbForTarget(running.id, ['emu', 'kill'], { timeoutMs: 15_000 });
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        } catch {
          throw new TestOrbitFrameworkError('COMMAND_FAILED', `Could not stop the running instance of "${args.avdName}" (${running.id}) before wiping.`);
        }
      }

      const cliArgs = ['-avd', args.avdName, '-wipe-data'];
      if (args.headless !== false) cliArgs.push('-no-window', '-no-audio');
      const beforeWipe = await listTargets();
      const tracked = startBackgroundProcess(findEmulatorBinary(), cliArgs, { targetId: args.avdName, kind: 'emulator' });
      const target = await waitForNewEmulator(beforeWipe, args.timeoutMs ?? 150_000);
      return textResult(`Wiped and rebooted "${args.avdName}" as ${target.id}.`, { target, processId: tracked.id });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
