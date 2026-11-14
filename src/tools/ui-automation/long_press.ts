import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveElementRef } from '../../automation/uiHierarchy.js';
import { resolveTargetAndBackend, getScreenSize } from './_shared.js';
import { isRecording, type RecordedSelector } from '../../automation/recorder.js';
import { finishRecordingProbe, startRecordingProbe } from './recording-probe.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'long_press';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Long Press',
      description: 'Long-press either a raw (x, y) point or an elementRef from the latest snapshot_ui output.',
      inputSchema: {
        elementRef: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        durationMs: z.number().optional().describe('Default 600.'),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: { elementRef?: string; x?: number; y?: number; durationMs?: number; targetId?: string }) => {
      const stepStart = Date.now();
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      let x = args.x;
      let y = args.y;
      let selector: RecordedSelector | undefined;
      if (args.elementRef) {
        const node = resolveElementRef(target.id, args.elementRef);
        x = node.centerX;
        y = node.centerY;
        selector = {
          ...(node.resourceId ? { resourceId: node.resourceId } : {}),
          ...(node.text ? { text: node.text } : {}),
          ...(node.contentDesc ? { contentDesc: node.contentDesc } : {}),
          ...(node.className ? { className: node.className } : {}),
        };
      }
      if (x === undefined || y === undefined) {
        throw new TestOrbitFrameworkError('INVALID_CONFIG', 'Provide either elementRef, or both x and y.');
      }
      const probe = await startRecordingProbe(backend, target.id);
      await backend.longPress(target.id, x, y, args.durationMs);
      if (isRecording(target.id)) {
        const screenSize = await getScreenSize(target.id);
        await finishRecordingProbe(probe, target.id, {
          type: 'long_press',
          durationMs: Date.now() - stepStart,
          selector,
          coordinates: { x, y },
          normalizedCoordinates: { x: x / screenSize.width, y: y / screenSize.height },
          screenSize,
        }, selector);
      }
      return textResult(`Long-pressed (${x}, ${y}) on ${target.id}.`, { target, x, y });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
