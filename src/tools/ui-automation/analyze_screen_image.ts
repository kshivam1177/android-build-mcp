import fs from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { captureImageElements } from '../../automation/imageElementCapture.js';
import { cacheSnapshot, parseUiHierarchy } from '../../automation/uiHierarchy.js';
import { resolveTargetAndBackend } from './_shared.js';
import { createArtifactPath, timestampedArtifactName } from '../../utils/artifacts.js';
import { withErrorHandling } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'analyze_screen_image';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Analyze Screen Image',
      description: 'Capture a device screenshot and semantic UI tree, optionally preprocess the image with Sharp, run OCR with Tesseract when installed, and map recognized text to element bounds and elementRef values. Saves screenshot and JSON analysis under .testorbit/artifacts.',
      inputSchema: {
        targetId: z.string().optional().describe('Target device ID; defaults to the active session target.'),
        projectPath: z.string().optional().describe('Project root for saved artifacts; defaults to the current working directory.'),
        minConfidence: z.number().min(0).max(100).optional().describe('Minimum Tesseract OCR confidence from 0 to 100; defaults to 45.'),
        tesseractPath: z.string().min(1).optional().describe('Optional path to the Tesseract executable.'),
        timeoutMs: z.number().int().min(1000).max(60000).optional().describe('OCR timeout in milliseconds; defaults to 15000.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: {
      targetId?: string;
      projectPath?: string;
      minConfidence?: number;
      tesseractPath?: string;
      timeoutMs?: number;
    }) => {
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      const [screenshot, hierarchy] = await Promise.all([
        backend.screenshot(target.id),
        backend.dumpHierarchy(target.id),
      ]);
      const allNodes = parseUiHierarchy(hierarchy);
      cacheSnapshot({ targetId: target.id, capturedAt: new Date().toISOString(), backend: backend.name, nodes: allNodes });
      const analysis = await captureImageElements({
        image: screenshot.data,
        nodes: allNodes,
        minConfidence: args.minConfidence,
        tesseractPath: args.tesseractPath,
        timeoutMs: args.timeoutMs,
      });
      const projectRoot = args.projectPath ?? process.cwd();
      const screenshotPath = createArtifactPath(projectRoot, 'screenshots', timestampedArtifactName(target.id, 'png'));
      const reportPath = createArtifactPath(projectRoot, 'image-analysis', timestampedArtifactName(target.id, 'json'));
      fs.writeFileSync(screenshotPath, screenshot.data);
      const report = {
        targetId: target.id,
        backend: backend.name,
        capturedAt: new Date().toISOString(),
        screenshotPath,
        reportPath,
        ...analysis,
      };
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(report, null, 2) },
          { type: 'image' as const, data: screenshot.data.toString('base64'), mimeType: screenshot.mimeType },
        ],
        structuredContent: report,
      };
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
