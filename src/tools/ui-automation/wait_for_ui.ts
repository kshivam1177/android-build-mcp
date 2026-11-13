import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { parseUiHierarchy, cacheSnapshot } from '../../automation/uiHierarchy.js';
import { resolveTargetAndBackend } from './_shared.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';
import type { UiNode } from '../../types.js';

export const toolName = 'wait_for_ui';
export const workflow = 'ui-automation';

function matches(nodes: UiNode[], textContains?: string, resourceId?: string): UiNode | undefined {
  return nodes.find((n) => {
    const textOk = textContains
      ? (n.text?.toLowerCase().includes(textContains.toLowerCase()) ?? false) ||
        (n.contentDesc?.toLowerCase().includes(textContains.toLowerCase()) ?? false)
      : true;
    const idOk = resourceId ? n.resourceId === resourceId : true;
    return textOk && idOk;
  });
}

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Wait For UI',
      description:
        'Poll the UI until a condition holds, then record the latest snapshot (same caching as snapshot_ui - refs from the result are usable directly). With textContains/resourceId: waits for a matching element to appear (or disappear, if gone:true). With neither: waits for the hierarchy to stop changing between polls ("settled").',
      inputSchema: {
        textContains: z.string().optional(),
        resourceId: z.string().optional(),
        gone: z.boolean().optional().describe('Wait for absence instead of presence. Default false.'),
        timeoutMs: z.number().optional().describe('Default 10000.'),
        pollIntervalMs: z.number().optional().describe('Default 500.'),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(
      async (args: {
        textContains?: string;
        resourceId?: string;
        gone?: boolean;
        timeoutMs?: number;
        pollIntervalMs?: number;
        targetId?: string;
      }) => {
        const { target, backend } = await resolveTargetAndBackend(args.targetId);
        const timeoutMs = args.timeoutMs ?? 10_000;
        const pollIntervalMs = args.pollIntervalMs ?? 500;
        const wantsPresence = Boolean(args.textContains || args.resourceId);
        const start = Date.now();
        let previousXml: string | null = null;

        for (;;) {
          const xml = await backend.dumpHierarchy(target.id);
          const nodes = parseUiHierarchy(xml);
          cacheSnapshot({ targetId: target.id, capturedAt: new Date().toISOString(), backend: backend.name, nodes });

          if (wantsPresence) {
            const found = matches(nodes, args.textContains, args.resourceId);
            const conditionMet = args.gone ? !found : Boolean(found);
            if (conditionMet) {
              return textResult(
                args.gone ? `Element is gone from ${target.id}.` : `Found matching element on ${target.id}.`,
                { target, elementCount: nodes.length, matchedRef: found?.ref }
              );
            }
          } else if (previousXml !== null && previousXml === xml) {
            return textResult(`UI settled on ${target.id}.`, { target, elementCount: nodes.length });
          }
          previousXml = xml;

          if (Date.now() - start > timeoutMs) {
            throw new TestOrbitFrameworkError('TIMEOUT', `wait_for_ui timed out after ${timeoutMs}ms on ${target.id}.`);
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }
    )
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
