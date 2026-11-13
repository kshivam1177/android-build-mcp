import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveTarget, getAdbPath, runAdbForTarget } from '../../utils/adb.js';
import { startBackgroundProcess, stopTrackedProcess, getTrackedProcess } from '../../utils/processRegistry.js';
import { createArtifactPath, timestampedArtifactName } from '../../utils/artifacts.js';
import type { ToolModule } from '../types.js';

export const toolName = 'record_emulator_video';
export const workflow = 'emulator-management';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Record Screen Video',
      description:
        'Start or stop an on-device screen recording (adb shell screenrecord) and pull the resulting .mp4 to the project artifacts folder on stop by default. Works on emulators and physical devices.',
      inputSchema: {
        action: z.enum(['start', 'stop']),
        targetId: z.string().optional(),
        processId: z.string().optional().describe('Required for action:"stop" - the processId returned by action:"start".'),
        projectPath: z.string().optional().describe('Project root for the recording; defaults to the current working directory.'),
        localOutputPath: z.string().optional().describe('Optional explicit output path. Defaults to .testorbit/artifacts/recordings/.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(
      async (args: { action: 'start' | 'stop'; targetId?: string; processId?: string; projectPath?: string; localOutputPath?: string }) => {
        if (args.action === 'start') {
          const target = await resolveTarget({ requestedId: args.targetId });
          const remotePath = `/sdcard/testorbit_${Date.now()}.mp4`;
          const tracked = startBackgroundProcess(getAdbPath(), ['-s', target.id, 'shell', 'screenrecord', remotePath], {
            targetId: target.id,
            kind: 'screenrecord',
          });
          return textResult(`Recording started on ${target.id}.`, { target, processId: tracked.id, remotePath });
        }

        if (!args.processId) {
          return textResult('processId is required for action:"stop".');
        }
        const tracked = getTrackedProcess(args.processId);
        const remotePathMatch = tracked.command.match(/(\/sdcard\/\S+\.mp4)/);
        const remotePath = remotePathMatch?.[1];
        stopTrackedProcess(args.processId);
        // screenrecord needs a moment to finalize the mp4 container after SIGINT.
        await new Promise((resolve) => setTimeout(resolve, 2_000));

        if (!remotePath) {
          return textResult('Stopped the recording, but could not determine the remote file path to pull.');
        }
        const localPath = args.localOutputPath
          ? path.resolve(args.localOutputPath)
          : createArtifactPath(
              args.projectPath ?? process.cwd(),
              'recordings',
              timestampedArtifactName(tracked.targetId, 'mp4')
            );
        await runAdbForTarget(tracked.targetId, ['pull', remotePath, localPath], { timeoutMs: 60_000 });
        return textResult(`Recording stopped and saved to ${localPath}.`, { localPath, remotePath });
      }
    )
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
