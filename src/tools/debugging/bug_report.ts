import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveTarget, runAdbForTarget } from '../../utils/adb.js';
import { createArtifactPath, timestampedArtifactName } from '../../utils/artifacts.js';
import type { ToolModule } from '../types.js';

export const toolName = 'bug_report';
export const workflow = 'debugging';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Bug Report',
      description:
        'Generate a full adb bugreport (system state, logs, dumpsys output for every service) and save it under .testorbit/artifacts/bugreports/ by default. This is comprehensive but slow - budget 1-3 minutes.',
      inputSchema: {
        targetId: z.string().optional(),
        projectPath: z.string().optional().describe('Project root for the bug report; defaults to the current working directory.'),
        localOutputPath: z.string().optional().describe('Optional explicit output path. Defaults to the project artifacts folder.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withErrorHandling(async (args: { targetId?: string; projectPath?: string; localOutputPath?: string }) => {
      const target = await resolveTarget({ requestedId: args.targetId });
      const outputPath = args.localOutputPath
        ? path.resolve(args.localOutputPath)
        : createArtifactPath(
            args.projectPath ?? process.cwd(),
            'bugreports',
            timestampedArtifactName(`bugreport-${target.id}`, 'zip')
          );
      await runAdbForTarget(target.id, ['bugreport', outputPath], { timeoutMs: 240_000 });
      return textResult(`Saved bug report for ${target.id} to ${outputPath}.`, { target, outputPath });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
