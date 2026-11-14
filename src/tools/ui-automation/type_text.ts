import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveElementRef } from '../../automation/uiHierarchy.js';
import { resolveTargetAndBackend, getScreenSize } from './_shared.js';
import { isRecording, type RecordedSelector } from '../../automation/recorder.js';
import { finishRecordingProbe, startRecordingProbe } from './recording-probe.js';
import type { ToolModule } from '../types.js';

export const toolName = 'type_text';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Type Text',
      description:
        'Type text into whatever field currently has focus. If elementRef is given, taps it first to focus it, then types. Only ASCII-range and common Latin text renders reliably through adb input text - non-Latin scripts and emoji generally need an IME-level workaround this tool does not attempt.',
      inputSchema: {
        text: z.string(),
        elementRef: z.string().optional().describe('Tapped first to focus, if given.'),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: { text: string; elementRef?: string; targetId?: string }) => {
      const stepStart = Date.now();
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      let selector: RecordedSelector | undefined;
      let focus: { x: number; y: number } | undefined;
      if (args.elementRef) {
        const node = resolveElementRef(target.id, args.elementRef);
        selector = {
          ...(node.resourceId ? { resourceId: node.resourceId } : {}),
          ...(node.text ? { text: node.text } : {}),
          ...(node.contentDesc ? { contentDesc: node.contentDesc } : {}),
          ...(node.className ? { className: node.className } : {}),
        };
        focus = { x: node.centerX, y: node.centerY };
      }
      const probe = await startRecordingProbe(backend, target.id);
      if (focus !== undefined) await backend.tap(target.id, focus.x, focus.y);
      await backend.typeText(target.id, args.text);
      if (isRecording(target.id)) {
        const screenSize = await getScreenSize(target.id);
        await finishRecordingProbe(probe, target.id, { type: 'type_text', durationMs: Date.now() - stepStart, text: args.text, selector, screenSize }, selector);
      }
      return textResult(`Typed text into ${target.id}.`, { target, length: args.text.length });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
