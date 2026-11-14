import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { imageResult, errorResult } from '../../utils/response.js';
import { createArtifactPath, timestampedArtifactName } from '../../utils/artifacts.js';
import { findProjectRoot } from '../../utils/paths.js';
import { getEffectiveSessionDefaults } from '../../session/defaults.js';
import { resolveTargetAndBackend } from './_shared.js';
import type { ToolModule } from '../types.js';

export const toolName = 'screenshot';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Screenshot',
      description:
        'Capture the current screen and always save it under .testorbit/artifacts/screenshots/<targetId>-<timestamp>.png before returning the image. The text response includes the absolute saved path.',
      inputSchema: {
        targetId: z.string().optional(),
        projectPath: z.string().optional().describe('Project root; auto-discovers the nearest framework config or Git root when omitted.'),
        outputPath: z.string().optional().describe('Optional additional copy path. The canonical project artifact is always saved as well.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { targetId?: string; projectPath?: string; outputPath?: string }) => {
      try {
        const { target, backend } = await resolveTargetAndBackend(args.targetId);
        const { data, mimeType } = await backend.screenshot(target.id);
        // Explicit MCP arguments win. Otherwise prefer saved session defaults,
        // but don't let a stale relative/default cwd prevent upward root discovery.
        let configuredProjectPath: string | undefined;
        try {
          configuredProjectPath = getEffectiveSessionDefaults().defaults.projectPath ?? undefined;
        } catch {
          // A missing or invalid daemon-side config must not prevent screenshot persistence.
        }
        const startPath = args.projectPath ?? configuredProjectPath ?? process.cwd();
        const projectRoot = findProjectRoot(path.resolve(startPath));
        const artifactPath = createArtifactPath(
          projectRoot,
          'screenshots',
          timestampedArtifactName(target.id, 'png')
        );
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
        fs.writeFileSync(artifactPath, data);

        let extraCopyPath: string | undefined;
        if (args.outputPath) {
          extraCopyPath = path.resolve(args.outputPath);
          if (extraCopyPath !== artifactPath) {
            fs.mkdirSync(path.dirname(extraCopyPath), { recursive: true });
            fs.copyFileSync(artifactPath, extraCopyPath);
          }
        }
        const message = [
          `Screenshot of ${target.id} (${mimeType}) saved to: ${path.resolve(artifactPath)}`,
          extraCopyPath && extraCopyPath !== artifactPath ? `Additional copy: ${extraCopyPath}` : undefined,
          'The image is attached below as base64-encoded MCP image content.',
        ].filter(Boolean).join('\n');
        return imageResult(data.toString('base64'), mimeType, message);
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
