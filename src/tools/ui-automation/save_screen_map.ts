import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createScreenMap } from '../../automation/screenMap.js';
import { parseUiHierarchy, cacheSnapshot } from '../../automation/uiHierarchy.js';
import { resolveTargetAndBackend } from './_shared.js';
import { runAdbShell } from '../../utils/adb.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'save_screen_map';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Save Screen Map',
      description: 'Quickly capture a screenshot and semantic Android UI hierarchy, then persist a project-specific screen map with selectors, bounds, absolute and normalized coordinates, and a fingerprint. Does not run OCR.',
      inputSchema: {
        screenId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
        targetId: z.string().optional(),
        projectPath: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: { screenId: string; targetId?: string; projectPath?: string }) => {
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      const [screenshot, hierarchy] = await Promise.all([
        backend.screenshot(target.id),
        backend.dumpHierarchy(target.id),
      ]);
      const nodes = parseUiHierarchy(hierarchy);
      cacheSnapshot({ targetId: target.id, capturedAt: new Date().toISOString(), backend: backend.name, nodes });
      const projectRoot = path.resolve(args.projectPath ?? process.cwd());
      const mapDir = path.join(projectRoot, '.testorbit', 'screen-maps');
      const imageDir = path.join(mapDir, 'images');
      fs.mkdirSync(imageDir, { recursive: true });
      const imageExtension = screenshot.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const screenshotPath = path.join(imageDir, `${args.screenId}.${imageExtension}`);
      const mapPath = path.join(mapDir, `${args.screenId}.json`);
      const display = await runAdbShell(target.id, ['wm', 'size']);
      const sizeMatch = display.stdout.match(/Override size: *([0-9]+)x([0-9]+)/) ?? display.stdout.match(/Physical size: *([0-9]+)x([0-9]+)/);
      const width = sizeMatch ? Number(sizeMatch[1]) : Math.max(0, ...nodes.map((node) => node.bounds.right));
      const height = sizeMatch ? Number(sizeMatch[2]) : Math.max(0, ...nodes.map((node) => node.bounds.bottom));
      if (width <= 0 || height <= 0) throw new Error('Could not determine screenshot dimensions for screen map.');
      const screenMap = createScreenMap({
        screenId: args.screenId,
        deviceId: target.id,
        backend: backend.name,
        screenshotPath: path.relative(projectRoot, screenshotPath).split(path.sep).join('/'),
        width,
        height,
        nodes,
      });
      fs.writeFileSync(screenshotPath, screenshot.data);
      fs.writeFileSync(mapPath, `${JSON.stringify(screenMap, null, 2)}\n`, 'utf8');
      const result = {
        success: true,
        screenId: args.screenId,
        fingerprint: screenMap.fingerprint,
        elementCount: screenMap.elements.length,
        screenshotPath: path.relative(projectRoot, screenshotPath),
        screenMapPath: path.relative(projectRoot, mapPath),
        note: 'Screen maps contain device-specific coordinates. Prefer stable selectors; the fingerprint is a version stamp only, never a run-time check, and there is no coordinate fallback.',
      };
      return textResult(JSON.stringify(result, null, 2), result);
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
