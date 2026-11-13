import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseUiHierarchy } from '../../automation/uiHierarchy.js';
import { describeFingerprintDiff, matchFingerprint } from '../../testorbit/core/fingerprint.js';
import { findMatchingNode } from '../../testorbit/core/matcher.js';
import { isInteractiveNode } from '../../testorbit/core/screen-identity.js';
import { ElementNotFoundError, TestOrbitError, UnknownScreenError } from '../../testorbit/domain/errors.js';
import { isPlatform, toElementId } from '../../testorbit/domain/types.js';
import type { ElementId, StableSelector } from '../../testorbit/domain/types.js';
import { getPlatformDir } from '../../testorbit/infrastructure/filesystem.js';
import { getConfigDir } from '../../config/loader.js';
import { runAdbShell } from '../../utils/adb.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { getScreenSize, resolveTargetAndBackend } from './_shared.js';
import type { UiNode } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'interact_screen';
export const workflow = 'ui-automation';

type LearnedElement = {
  id: string;
  /** Absent in pre-TestOrbit elements.json files (clean break: re-learn). */
  stableSelector?: StableSelector;
  /**
   * TestOrbit v2 elements.json carries no stored centers: taps use the live
   * node's coordinates, so these are absent for screens learned by
   * orbit_learn_screen and present only in pre-TestOrbit files.
   */
  center?: { x: number; y: number };
  normalizedCenter?: { x: number; y: number };
  clickable?: boolean;
  enabled?: boolean;
  bounds?: { left: number; top: number; right: number; bottom: number };
};

/** A learned element without a stableSelector was learned before TestOrbit v2. */
function requireStableSelector(element: LearnedElement): StableSelector {
  if (element.stableSelector === undefined) {
    throw new Error(`Learned element "${element.id}" has no stableSelector. Re-run orbit_learn_screen for this screen.`);
  }
  return element.stableSelector;
}

/**
 * Find a learned element's live node by stable selector only (B5): never
 * text, never bounds, never coordinates. A missed match returns
 * undefined — the caller fails loudly; there is no coordinate fallback.
 */
function findNode(nodes: UiNode[], element: LearnedElement): UiNode | undefined {
  return findMatchingNode(nodes, requireStableSelector(element));
}

/**
 * Verify the live screen against the learned elements with the
 * fingerprint v2 set-match (B4): the learned elements.json is the base
 * set with required=[] and excluded=[], so the 10% drift budget over the
 * learned element set decides "same screen". The old exact-hash equality
 * check is abolished.
 *
 * @throws UnknownScreenError with the exact diff when the screen mismatches.
 */
function verifyScreen(nodes: UiNode[], elements: LearnedElement[], screenId: string, display: { width: number; height: number }): void {
  const learned = elements.map((element) => {
    const mapped: {
      id: ElementId;
      selector: StableSelector;
      clickable: boolean;
      enabled: boolean;
      bounds?: { left: number; top: number; right: number; bottom: number };
    } = {
      id: toElementId(element.id),
      selector: requireStableSelector(element),
      clickable: element.clickable ?? true,
      enabled: element.enabled ?? true,
    };
    if (element.bounds !== undefined) mapped.bounds = element.bounds;
    return mapped;
  });
  const result = matchFingerprint({
    learned,
    required: [],
    excluded: [],
    fresh: nodes.filter(isInteractiveNode),
    display,
  });
  if (!result.matched) {
    throw new UnknownScreenError(
      `Current screen does not match learned screen "${screenId}".\n${describeFingerprintDiff(result)}`,
      'Re-run orbit_learn_screen for the current layout or pass verifyScreen=false deliberately.',
      { screenId },
    );
  }
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Interact with Learned Screen',
    description: 'Execute a bounded sequence of actions against a previously learned screen without returning to the LLM between each action. Verifies the screen with the fingerprint v2 set-match by default and returns per-action results plus an optional final screenshot. A missing element fails the action loudly; there is no coordinate fallback.',
    inputSchema: {
      screenId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
      actions: z.array(z.object({
        type: z.enum(['tap', 'type', 'clear_and_type', 'select', 'scroll_to', 'wait', 'back', 'hide_keyboard']),
        elementId: z.string().optional(),
        value: z.string().optional(),
        waitMs: z.number().min(0).max(30_000).optional(),
      })).min(1).max(50),
      captureAfter: z.boolean().optional().default(true),
      verifyScreen: z.boolean().optional().default(true),
      targetId: z.string().optional(),
      projectPath: z.string().optional(),
      platform: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: {
    screenId: string;
    actions: Array<{ type: 'tap'|'type'|'clear_and_type'|'select'|'scroll_to'|'wait'|'back'|'hide_keyboard'; elementId?: string; value?: string; waitMs?: number }>;
    captureAfter?: boolean; verifyScreen?: boolean; targetId?: string; projectPath?: string; platform?: string;
  }) => {
    const platform = args.platform ?? 'android';
    if (!isPlatform(platform)) {
      throw new TestOrbitError(
        'INVALID_PLATFORM',
        `Unsupported platform "${platform}": expected one of android, ios, flutter, web.`,
        'Pass a supported platform.',
        { platform },
      );
    }
    const projectRoot = path.resolve(args.projectPath ?? process.cwd());
    // Screens live under the platform directory (Phase 1 task 9 clean
    // break): orbit_learn_screen writes them there, so this tool reads them
    // from the same place.
    const screenDir = path.join(getPlatformDir(projectRoot, platform), 'screens', args.screenId);
    const screenPath = path.join(screenDir, 'screen.json');
    const elementsPath = path.join(screenDir, 'elements.json');
    if (!fs.existsSync(screenPath) || !fs.existsSync(elementsPath)) {
      throw new Error(`Screen "${args.screenId}" has not been learned. Call orbit_learn_screen first.`);
    }
    const elements = JSON.parse(fs.readFileSync(elementsPath, 'utf8')) as LearnedElement[];
    const { target, backend } = await resolveTargetAndBackend(args.targetId);
    let nodes = parseUiHierarchy(await backend.dumpHierarchy(target.id));
    const display = await getScreenSize(target.id);
    if (args.verifyScreen !== false) {
      verifyScreen(nodes, elements, args.screenId, display);
    }
    const results: Array<{ index: number; type: string; status: 'ok'|'failed'; durationMs: number; message?: string }> = [];
    for (let i = 0; i < args.actions.length; i++) {
      const action = args.actions[i]!;
      const started = Date.now();
      try {
        if (action.type === 'wait') {
          await new Promise((resolve) => setTimeout(resolve, action.waitMs ?? 500));
        } else if (action.type === 'back') {
          await backend.keyEvent(target.id, '4');
        } else if (action.type === 'hide_keyboard') {
          await backend.keyEvent(target.id, '111');
        } else {
          if (!action.elementId) throw new Error(`${action.type} requires elementId.`);
          const element = elements.find((item) => item.id === action.elementId);
          if (!element) throw new Error(`Unknown elementId "${action.elementId}" in learned screen.`);
          if (action.type === 'scroll_to') {
            let found = findNode(nodes, element);
            for (let attempt = 0; !found && attempt < 8; attempt++) {
              await backend.swipe(target.id, display.width / 2, display.height * 0.78, display.width / 2, display.height * 0.30, 350);
              nodes = parseUiHierarchy(await backend.dumpHierarchy(target.id));
              found = findNode(nodes, element);
            }
            if (!found) throw new Error(`Could not find element "${action.elementId}" after scrolling.`);
            await backend.tap(target.id, found.centerX, found.centerY);
          } else {
            const node = findNode(nodes, element);
            if (node === undefined) {
              throw new ElementNotFoundError(
                `Element "${action.elementId}" was not found on the current screen.`,
                'Re-run orbit_learn_screen for the current layout, or check that the screen has not changed.',
                { elementId: action.elementId, screenId: args.screenId },
              );
            }
            if (action.type === 'tap' || action.type === 'select') {
              await backend.tap(target.id, node.centerX, node.centerY);
            } else {
              if (action.value === undefined) throw new Error(`${action.type} requires value.`);
              await backend.tap(target.id, node.centerX, node.centerY);
              if (action.type === 'clear_and_type') {
                await backend.keyEvent(target.id, 'KEYCODE_MOVE_END');
                await runAdbShell(target.id, ['input', 'keyevent', ...Array.from({ length: 100 }, () => 'KEYCODE_DEL')], { timeoutMs: 15_000 });
              }
              await backend.typeText(target.id, action.value);
            }
          }
        }
        results.push({ index: i, type: action.type, status: 'ok', durationMs: Date.now() - started });
      } catch (error) {
        results.push({ index: i, type: action.type, status: 'failed', durationMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
    let screenshotPath: string | null = null;
    if (args.captureAfter !== false) {
      const shot = await backend.screenshot(target.id);
      const dir = path.join(getConfigDir(projectRoot), 'artifacts', 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      screenshotPath = path.join(dir, `${args.screenId}-${timestamp}.png`);
      fs.writeFileSync(screenshotPath, shot.data);
    }
    const result = { success: results.length === args.actions.length && results.every((item) => item.status === 'ok'), screenId: args.screenId, screenVerified: args.verifyScreen !== false, actionsExecuted: results.length, actionResults: results, screenshotPath: screenshotPath ? path.relative(projectRoot, screenshotPath) : null };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
