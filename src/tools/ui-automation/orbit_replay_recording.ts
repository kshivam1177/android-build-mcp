import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseUiHierarchy } from '../../automation/uiHierarchy.js';
import { validateRecordingId } from '../../automation/recorder.js';
import type { TestOrbitRecordedAction, TestOrbitRecordingDocument } from '../../testorbit/domain/recording-schemas.js';
import { readRecordingFile, resolveRecordingPath } from '../../testorbit/infrastructure/recording-reader.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveTargetAndBackend, getScreenSize } from './_shared.js';
import type { UiNode } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'orbit_replay_recording';
export const workflow = 'ui-automation';

const MAX_RECORDING_BYTES = 2 * 1024 * 1024;

function selectorMatches(node: UiNode, selector: NonNullable<TestOrbitRecordedAction['selector']>): boolean {
  const fields = Object.entries(selector).filter(([, value]) => Boolean(value));
  if (!fields.length) return false;
  return fields.every(([key, value]) => {
    const actual = key === 'resourceId' ? node.resourceId
      : key === 'contentDesc' ? node.contentDesc
      : key === 'className' ? node.className
      : key === 'text' ? node.text : undefined;
    return actual === value;
  });
}

async function readRecording(projectRoot: string, flowId: string): Promise<TestOrbitRecordingDocument> {
  const safeId = validateRecordingId(flowId);
  const file = resolveRecordingPath(projectRoot, 'android', safeId);
  const size = fsSync.statSync(file).size;
  if (size > MAX_RECORDING_BYTES) throw new Error(`Recording exceeds the ${MAX_RECORDING_BYTES}-byte safety limit.`);
  const { document: value } = readRecordingFile(file);
  if (value.flowId !== safeId || !Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 500) {
    throw new Error('Invalid recording format: expected a matching flowId and 1-500 actions.');
  }
  for (const action of value.actions) {
    if (!action || !['tap', 'long_press', 'swipe', 'type_text', 'key_press'].includes(action.type)) throw new Error('Recording contains an unsupported action type.');
    if (typeof action.id !== 'string' || typeof action.durationMs !== 'number') throw new Error('Recording contains a malformed action.');
  }
  return value;
}

async function resolveCoordinates(action: TestOrbitRecordedAction, targetId: string): Promise<{ x: number; y: number }> {
  if (action.normalizedCoordinates) {
    const size = await getScreenSize(targetId);
    return { x: Math.round(action.normalizedCoordinates.x * size.width), y: Math.round(action.normalizedCoordinates.y * size.height) };
  }
  if (action.coordinates) return { x: action.coordinates.x, y: action.coordinates.y };
  throw new Error('Action has neither a semantic selector nor saved coordinates.');
}

async function findSelectorNode(backend: Awaited<ReturnType<typeof resolveTargetAndBackend>>['backend'], targetId: string, selector: NonNullable<TestOrbitRecordedAction['selector']>): Promise<UiNode> {
  const nodes = parseUiHierarchy(await backend.dumpHierarchy(targetId));
  const matches = nodes.filter((node) => selectorMatches(node, selector));
  if (matches.length !== 1) throw new Error(`Selector matched ${matches.length} UI elements; refusing ambiguous replay.`);
  return matches[0]!;
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Replay UI Recording',
    description: 'Replay a saved orbit_start_recording/orbit_stop_recording flow. Semantic selectors are preferred; coordinate actions are scaled to the current display size. Stops on first failure by default and saves a timestamped report plus failure screenshot/hierarchy evidence.',
    inputSchema: {
      flowId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
      targetId: z.string().optional().describe('Optional target override; defaults to the currently selected Android device.'),
      projectPath: z.string().optional(),
      continueOnFailure: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { flowId: string; targetId?: string; projectPath?: string; continueOnFailure?: boolean }) => {
    const projectRoot = path.resolve(args.projectPath ?? process.cwd());
    const recording = await readRecording(projectRoot, args.flowId);
    const { target, backend } = await resolveTargetAndBackend(args.targetId);
    const startedAt = new Date();
    const started = Date.now();
    const reportSteps: Array<{ id: string; type: string; status: 'passed' | 'failed'; durationMs: number; message?: string }> = [];
    const evidenceDir = path.join(projectRoot, '.testorbit', 'recording-evidence', recording.flowId, 'replays');
    await fs.mkdir(evidenceDir, { recursive: true });

    for (const action of recording.actions) {
      const stepStart = Date.now();
      try {
        switch (action.type) {
          case 'tap':
          case 'long_press': {
            let coordinates: { x: number; y: number };
            if (action.selector) {
              const node = await findSelectorNode(backend, target.id, action.selector);
              coordinates = { x: node.centerX, y: node.centerY };
            } else coordinates = await resolveCoordinates(action, target.id);
            if (action.type === 'tap') await backend.tap(target.id, coordinates.x, coordinates.y);
            else await backend.longPress(target.id, coordinates.x, coordinates.y, action.durationMs);
            break;
          }
          case 'swipe': {
            let swipe = action.swipe;
            if (action.normalizedSwipe) {
              const size = await getScreenSize(target.id);
              swipe = {
                startX: Math.round(action.normalizedSwipe.startX * size.width),
                startY: Math.round(action.normalizedSwipe.startY * size.height),
                endX: Math.round(action.normalizedSwipe.endX * size.width),
                endY: Math.round(action.normalizedSwipe.endY * size.height),
              };
            }
            if (!swipe) throw new Error('Swipe action has no coordinates.');
            await backend.swipe(target.id, swipe.startX, swipe.startY, swipe.endX, swipe.endY, action.durationMs);
            break;
          }
          case 'type_text':
            if (action.redacted || action.text === undefined) throw new Error('Typed text was redacted or omitted; replace it in the recording JSON before replay.');
            if (action.selector) {
              const node = await findSelectorNode(backend, target.id, action.selector);
              await backend.tap(target.id, node.centerX, node.centerY);
            }
            await backend.typeText(target.id, action.text);
            break;
          case 'key_press':
            if (!action.keyCode) throw new Error('Key action has no keyCode.');
            await backend.keyEvent(target.id, action.keyCode);
            break;
        }
        reportSteps.push({ id: action.id, type: action.type, status: 'passed', durationMs: Date.now() - stepStart });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportSteps.push({ id: action.id, type: action.type, status: 'failed', durationMs: Date.now() - stepStart, message });
        const evidenceBase = path.join(evidenceDir, `${Date.now()}-${action.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
        try {
          const screenshot = await backend.screenshot(target.id);
          await fs.writeFile(`${evidenceBase}.png`, screenshot.data);
        } catch { /* report still records the failure if screenshot capture is unavailable */ }
        try {
          const hierarchy = await backend.dumpHierarchy(target.id);
          await fs.writeFile(`${evidenceBase}.xml`, hierarchy, 'utf8');
        } catch { /* hierarchy capture is best effort */ }
        if (!args.continueOnFailure) break;
      }
    }

    const success = reportSteps.length === recording.actions.length && reportSteps.every((step) => step.status === 'passed');
    const date = startedAt.toISOString().slice(0, 10);
    const time = startedAt.toISOString().slice(11, 19).replace(/:/g, '');
    const runId = randomUUID().slice(0, 8);
    const reportDir = path.join(projectRoot, '.testorbit', 'test-reports', date, `${time}-replay-${runId}`);
    await fs.mkdir(reportDir, { recursive: true });
    const report = {
      schemaVersion: 1,
      flowId: recording.flowId,
      deviceId: target.id,
      recordedDeviceId: recording.deviceId,
      success,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - started,
      steps: reportSteps,
      evidenceDirectory: path.relative(projectRoot, evidenceDir).split(path.sep).join('/'),
    };
    const reportPath = path.join(reportDir, 'replay-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return textResult(`Replay ${success ? 'passed' : 'failed'} for "${recording.flowId}" (${reportSteps.filter((step) => step.status === 'passed').length}/${recording.actions.length} steps passed). Report: ${path.relative(projectRoot, reportPath)}`, {
      ...report,
      reportPath: path.relative(projectRoot, reportPath).split(path.sep).join('/'),
    });
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
