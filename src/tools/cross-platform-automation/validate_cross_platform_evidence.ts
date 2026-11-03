import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateEvidenceManifest } from '../../platform/reporting/evidenceManifest.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'validate_cross_platform_evidence';
export const workflow = 'cross-platform-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Validate Cross-Platform Evidence Bundle',
    description: 'Independently verify a saved cross-platform suite evidence manifest, including SHA-256 hashes, file sizes, missing or unexpected artifacts, and unsafe paths. Only report directories beneath .androidmcp-framework/test-reports are accepted.',
    inputSchema: {
      projectPath: z.string().optional(),
      reportDirectory: z.string().min(1).max(1024).describe('Project-relative report directory containing evidence-manifest.json.')
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, withErrorHandling(async (args: { projectPath?: string; reportDirectory: string }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const reportsRoot = path.resolve(root, '.androidmcp-framework', 'test-reports');
    const directory = path.resolve(root, args.reportDirectory);
    const relative = path.relative(reportsRoot, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).includes('.runs')) {
      throw new Error('reportDirectory must identify a run directory beneath .androidmcp-framework/test-reports and cannot target internal .runs state.');
    }
    const rootReal = await fs.realpath(reportsRoot);
    const directoryStat = await fs.lstat(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('Evidence report directory must be a real directory, not a symlink.');
    const directoryReal = await fs.realpath(directory);
    const realRelative = path.relative(rootReal, directoryReal);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error('Resolved report directory escapes the canonical test-reports directory.');
    }
    const result = await validateEvidenceManifest(directoryReal);
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
