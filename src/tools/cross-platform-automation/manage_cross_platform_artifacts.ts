import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'manage_cross_platform_artifacts';
export const workflow = 'cross-platform-automation';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const runPattern = /^\d{2}-\d{2}-\d{2}-cross-platform-suite-[a-f0-9]{8}$/i;

export async function findExpiredReports(reportsRoot: string, retentionDays: number) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const candidates: string[] = [];
  let dates: string[];
  try { dates = await fs.readdir(reportsRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidates;
    throw error;
  }
  for (const dateName of dates) {
    if (!datePattern.test(dateName)) continue;
    const date = new Date(dateName + 'T00:00:00.000Z');
    if (!Number.isFinite(date.getTime()) || date.getTime() >= cutoff) continue;
    const dateDirectory = path.join(reportsRoot, dateName);
    const dateStat = await fs.lstat(dateDirectory);
    if (dateStat.isSymbolicLink() || !dateStat.isDirectory()) continue;
    for (const runName of await fs.readdir(dateDirectory)) {
      if (!runPattern.test(runName)) continue;
      const runDirectory = path.join(dateDirectory, runName);
      const runStat = await fs.lstat(runDirectory);
      if (runStat.isSymbolicLink() || !runStat.isDirectory()) continue;
      const manifest = path.join(runDirectory, 'evidence-manifest.json');
      try {
        const manifestStat = await fs.lstat(manifest);
        if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      candidates.push(runDirectory);
    }
  }
  return candidates.sort();
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Manage Cross-Platform Test Artifacts',
    description: 'Inspect or prune expired framework-generated cross-platform suite report folders. Pruning is dry-run by default and only targets date/run directories matching the framework naming convention that contain a regular evidence manifest. Internal checkpoints and arbitrary files are never selected.',
    inputSchema: {
      action: z.enum(['inspect', 'prune']),
      projectPath: z.string().optional(),
      retentionDays: z.number().int().min(1).max(3650).optional().default(30),
      dryRun: z.boolean().optional().default(true),
      confirm: z.boolean().optional().default(false)
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, withErrorHandling(async (args: { action: 'inspect' | 'prune'; projectPath?: string; retentionDays?: number; dryRun?: boolean; confirm?: boolean }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const reportsRoot = path.resolve(root, '.androidmcp-framework', 'test-reports');
    const retentionDays = args.retentionDays ?? 30;
    const candidates = await findExpiredReports(reportsRoot, retentionDays);
    if (args.action === 'inspect' || args.dryRun !== false) {
      const result = { action: args.action, dryRun: true, retentionDays, candidateCount: candidates.length, candidates: candidates.map((item) => path.relative(root, item).split(path.sep).join('/')), deleted: [] as string[] };
      return textResult(JSON.stringify(result, null, 2), result);
    }
    if (!args.confirm) throw new Error('Destructive pruning requires confirm=true after reviewing a dry-run candidate list.');
    const deleted: string[] = [];
    for (const candidate of candidates) {
      const relative = path.relative(reportsRoot, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).length !== 2) throw new Error('Refusing to prune a path outside the expected date/run directory layout.');
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Report candidate changed type during pruning: ' + candidate);
      await fs.rm(candidate, { recursive: true, force: false });
      deleted.push(path.relative(root, candidate).split(path.sep).join('/'));
    }
    const result = { action: 'prune', dryRun: false, retentionDays, candidateCount: candidates.length, deleted };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
