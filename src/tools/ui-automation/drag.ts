import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveElementRef } from '../../automation/uiHierarchy.js';
import { resolveTargetAndBackend } from './_shared.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'drag';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Drag',
      description:
        'Press-and-drag from one point to another (adb shell input draganddrop) - for reordering list items or drag targets, where a quick swipe would be interpreted as a flick instead of a hold-and-move. Endpoints can be elementRefs from the latest snapshot_ui, or raw coordinates.',
      inputSchema: {
        startElementRef: z.string().optional(),
        endElementRef: z.string().optional(),
        startX: z.number().optional(),
        startY: z.number().optional(),
        endX: z.number().optional(),
        endY: z.number().optional(),
        durationMs: z.number().optional().describe('Default 800.'),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(
      async (args: {
        startElementRef?: string;
        endElementRef?: string;
        startX?: number;
        startY?: number;
        endX?: number;
        endY?: number;
        durationMs?: number;
        targetId?: string;
      }) => {
        const { target, backend } = await resolveTargetAndBackend(args.targetId);
        let startX = args.startX;
        let startY = args.startY;
        let endX = args.endX;
        let endY = args.endY;
        if (args.startElementRef) {
          const node = resolveElementRef(target.id, args.startElementRef);
          startX = node.centerX;
          startY = node.centerY;
        }
        if (args.endElementRef) {
          const node = resolveElementRef(target.id, args.endElementRef);
          endX = node.centerX;
          endY = node.centerY;
        }
        if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) {
          throw new TestOrbitFrameworkError('INVALID_CONFIG', 'Provide start/end as elementRefs or as raw x/y pairs.');
        }
        await backend.drag(target.id, startX, startY, endX, endY, args.durationMs);
        return textResult(`Dragged (${startX},${startY}) -> (${endX},${endY}) on ${target.id}.`, { target });
      }
    )
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
