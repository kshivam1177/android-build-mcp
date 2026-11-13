import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveTargetAndBackend } from './_shared.js';
import { isRecording } from '../../automation/recorder.js';
import { finishRecordingProbe, startRecordingProbe } from './recording-probe.js';
import type { ToolModule } from '../types.js';

export const toolName = 'key_press';
export const workflow = 'ui-automation';

const KEY_ALIASES: Record<string, string> = {
  BACK: 'KEYCODE_BACK',
  ESCAPE: 'KEYCODE_ESCAPE',
  ENTER: 'KEYCODE_ENTER',
  DEL: 'KEYCODE_DEL',
  DELETE: 'KEYCODE_DEL',
  TAB: 'KEYCODE_TAB',
  HOME: 'KEYCODE_HOME',
  MENU: 'KEYCODE_MENU',
  SPACE: 'KEYCODE_SPACE',
};

export function normalizeKeyCode(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const trimmed = value.trim();
  if (!trimmed) throw new Error('keyCode must not be empty.');
  const upper = trimmed.toUpperCase();
  if (/^\d+$/.test(upper)) return upper;
  return KEY_ALIASES[upper] ?? (upper.startsWith('KEYCODE_') ? upper : upper);
}

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Key Press',
      description:
        'Send an Android key event. Accepts symbolic names (KEYCODE_BACK, BACK, ENTER), numeric strings ("4"), or integer codes (4).',
      inputSchema: {
        keyCode: z.union([z.string().min(1), z.number().int().nonnegative()]).describe('Android key name or integer code, e.g. "KEYCODE_BACK", "BACK", or 4.'),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: { keyCode: string | number; targetId?: string }) => {
      const stepStart = Date.now();
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      const keyCode = normalizeKeyCode(args.keyCode);
      const probe = await startRecordingProbe(backend, target.id);
      await backend.keyEvent(target.id, keyCode);
      if (isRecording(target.id)) await finishRecordingProbe(probe, target.id, { type: 'key_press', durationMs: Date.now() - stepStart, keyCode });
      return textResult(`Sent ${keyCode} to ${target.id}.`, { target, keyCode, inputKeyCode: args.keyCode });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
