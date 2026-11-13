import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { parseUiHierarchy, resolveElementRef } from '../../automation/uiHierarchy.js';
import { runAdbShell } from '../../utils/adb.js';
import { resolveTargetAndBackend } from './_shared.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'batch';
export const workflow = 'ui-automation';

const StepSchema = z.object({
  action: z.enum(['tap', 'long_press', 'swipe', 'type_text', 'key_press', 'wait', 'hide_keyboard', 'clear_and_type', 'assert_text_visible', 'assert_text_gone']),
  elementRef: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  startX: z.number().optional(),
  startY: z.number().optional(),
  endX: z.number().optional(),
  endY: z.number().optional(),
  durationMs: z.number().optional(),
  text: z.string().optional(),
  keyCode: z.string().optional(),
  waitMs: z.number().min(0).max(30_000).optional(),
  assertText: z.string().optional(),
});

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Batch',
      description:
        'Run a sequence of UI actions in one MCP call: taps, typing, waits, keyboard dismissal, clear-and-type, and text assertions. Stops at the first failed action or assertion so later steps never run against an unknown UI state.',
      inputSchema: {
        steps: z.array(StepSchema).min(1).max(100),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: { steps: z.infer<typeof StepSchema>[]; targetId?: string }) => {
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      const results: Array<{ step: number; action: string; ok: boolean; error?: string }> = [];

      for (let i = 0; i < args.steps.length; i++) {
        const step = args.steps[i] as z.infer<typeof StepSchema>;
        try {
          let x = step.x;
          let y = step.y;
          if (step.elementRef) {
            const node = resolveElementRef(target.id, step.elementRef);
            x = node.centerX;
            y = node.centerY;
          }

          switch (step.action) {
            case 'tap':
              if (x === undefined || y === undefined) throw new TestOrbitFrameworkError('INVALID_CONFIG', 'tap needs elementRef or x/y.');
              await backend.tap(target.id, x, y);
              break;
            case 'long_press':
              if (x === undefined || y === undefined) throw new TestOrbitFrameworkError('INVALID_CONFIG', 'long_press needs elementRef or x/y.');
              await backend.longPress(target.id, x, y, step.durationMs);
              break;
            case 'swipe':
              if (step.startX === undefined || step.startY === undefined || step.endX === undefined || step.endY === undefined) {
                throw new TestOrbitFrameworkError('INVALID_CONFIG', 'swipe needs startX/startY/endX/endY.');
              }
              await backend.swipe(target.id, step.startX, step.startY, step.endX, step.endY, step.durationMs);
              break;
            case 'type_text':
              if (step.text === undefined) throw new TestOrbitFrameworkError('INVALID_CONFIG', 'type_text needs text.');
              if (step.elementRef && x !== undefined && y !== undefined) await backend.tap(target.id, x, y);
              await backend.typeText(target.id, step.text);
              break;
            case 'key_press':
              if (!step.keyCode) throw new TestOrbitFrameworkError('INVALID_CONFIG', 'key_press needs keyCode.');
              await backend.keyEvent(target.id, step.keyCode);
              break;
            case 'wait':
              await new Promise((resolve) => setTimeout(resolve, step.waitMs ?? 500));
              break;
            case 'hide_keyboard':
              await backend.keyEvent(target.id, '111'); // KEYCODE_ESCAPE
              break;
            case 'clear_and_type':
              if (x === undefined || y === undefined) {
                throw new TestOrbitFrameworkError('INVALID_CONFIG', 'clear_and_type needs elementRef or x/y.');
              }
              if (step.text === undefined) {
                throw new TestOrbitFrameworkError('INVALID_CONFIG', 'clear_and_type needs text.');
              }
              await backend.tap(target.id, x, y);
              await backend.keyEvent(target.id, 'KEYCODE_MOVE_END');
              await runAdbShell(target.id, ['input', 'keyevent', ...Array.from({ length: 100 }, () => 'KEYCODE_DEL')], { timeoutMs: 15_000 });
              await backend.typeText(target.id, step.text);
              break;
            case 'assert_text_visible':
            case 'assert_text_gone': {
              if (!step.assertText) {
                throw new TestOrbitFrameworkError('INVALID_CONFIG', `${step.action} needs assertText.`);
              }
              const xml = await backend.dumpHierarchy(target.id);
              const nodes = parseUiHierarchy(xml);
              const found = nodes.some((node) =>
                (node.text ?? '').includes(step.assertText!) ||
                (node.contentDesc ?? '').includes(step.assertText!)
              );
              if (step.action === 'assert_text_visible' && !found) {
                throw new TestOrbitFrameworkError('COMMAND_FAILED', `Assertion failed: "${step.assertText}" is not visible.`);
              }
              if (step.action === 'assert_text_gone' && found) {
                throw new TestOrbitFrameworkError('COMMAND_FAILED', `Assertion failed: "${step.assertText}" is still visible.`);
              }
              break;
            }
          }
          results.push({ step: i, action: step.action, ok: true });
        } catch (err) {
          results.push({ step: i, action: step.action, ok: false, error: err instanceof Error ? err.message : String(err) });
          break; // stop at first failure rather than continuing on an unknown UI state
        }
      }

      return textResult(JSON.stringify(results, null, 2), { target, results });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
