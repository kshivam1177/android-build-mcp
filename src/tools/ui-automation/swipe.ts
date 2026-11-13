import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveTargetAndBackend, getScreenSize, directionToCoords } from './_shared.js';
import { TestOrbitFrameworkError } from '../../types.js';
import { isRecording } from '../../automation/recorder.js';
import { finishRecordingProbe, startRecordingProbe } from './recording-probe.js';
import type { ToolModule } from '../types.js';

export const toolName = 'swipe';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Swipe',
      description: 'Swipe either by explicit start/end coordinates, or a screen-relative direction ("up"|"down"|"left"|"right") computed from the current screen size.',
      inputSchema: {
        direction: z.enum(['up', 'down', 'left', 'right']).optional(),
        distance: z.number().optional().describe('Screen-relative distance for direction mode, 0-1. Default 0.6.'),
        startX: z.number().optional(),
        startY: z.number().optional(),
        endX: z.number().optional(),
        endY: z.number().optional(),
        durationMs: z.number().optional().describe('Default 300.'),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(
      async (args: {
        direction?: 'up' | 'down' | 'left' | 'right';
        distance?: number;
        startX?: number;
        startY?: number;
        endX?: number;
        endY?: number;
        durationMs?: number;
        targetId?: string;
      }) => {
        const stepStart = Date.now();
        const { target, backend } = await resolveTargetAndBackend(args.targetId);
        let { startX, startY, endX, endY } = args;
        if (args.direction) {
          const screen = await getScreenSize(target.id);
          ({ startX, startY, endX, endY } = directionToCoords(args.direction, screen, args.distance));
        }
        if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) {
          throw new TestOrbitFrameworkError('INVALID_CONFIG', 'Provide either direction, or all of startX/startY/endX/endY.');
        }
        const probe = await startRecordingProbe(backend, target.id);
        await backend.swipe(target.id, startX, startY, endX, endY, args.durationMs);
        if (isRecording(target.id)) {
          const screenSize = await getScreenSize(target.id);
          await finishRecordingProbe(probe, target.id, {
            type: 'swipe',
            durationMs: Date.now() - stepStart,
            swipe: { startX, startY, endX, endY },
            normalizedSwipe: {
              startX: startX / screenSize.width,
              startY: startY / screenSize.height,
              endX: endX / screenSize.width,
              endY: endY / screenSize.height,
            },
            screenSize,
          });
        }
        return textResult(`Swiped (${startX},${startY}) -> (${endX},${endY}) on ${target.id}.`, {
          target,
          startX,
          startY,
          endX,
          endY,
        });
      }
    )
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
