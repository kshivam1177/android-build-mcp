import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfigDir } from '../../config/loader.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { redactDiagnosticText } from '../../testing-intelligence/runtimeSafety.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'inspect_test_runtime';
export const workflow = 'testing-intelligence';

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

async function listJsonFiles(directory: string): Promise<string[]> {
  try { return (await fs.readdir(directory)).filter((name) => name.endsWith('.json')).sort().reverse(); }
  catch { return []; }
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Inspect TestOrbit Test Runtime',
    description: 'Read-only overview of the current project config, active-run lock, resumable run manifests, and latest test report. Returns metadata and gate summaries only; it does not execute commands or expose raw logs.',
    inputSchema: {
      projectPath: z.string().optional(),
      maxRuns: z.number().int().min(1).max(20).optional().default(5),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; maxRuns?: number }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const configDir = getConfigDir(root);
    const reportRoot = path.join(configDir, 'test-reports');
    const lockPath = path.join(configDir, '.run-lock');
    let lock: Record<string, unknown> | null = null;
    try { lock = await readJson(path.join(lockPath, 'owner.json')) ?? null; } catch { /* absent lock */ }
    const runDirectory = path.join(reportRoot, '.runs');
    const runFiles = (await listJsonFiles(runDirectory)).slice(0, args.maxRuns ?? 5);
    const runs = [];
    for (const filename of runFiles) {
      const value = await readJson(path.join(runDirectory, filename));
      if (!value) continue;
      const work = Array.isArray(value.work) ? value.work as Array<Record<string, unknown>> : [];
      runs.push({
        runId: typeof value.runId === 'string' ? value.runId : filename.replace(/\.json$/, ''),
        updatedAt: value.updatedAt ?? null,
        status: value.status ?? (work.some((item) => item.status === 'running') ? 'running-or-interrupted' : 'resumable-manifest'),
        gitHeadSha: value.gitHeadSha ?? null,
        work: { total: work.length, passed: work.filter((item) => item.status === 'passed').length,
          failed: work.filter((item) => item.status === 'failed').length,
          incomplete: work.filter((item) => !['passed', 'failed'].includes(String(item.status))).length },
        reportDirectory: typeof value.reportDirectory === 'string' ? redactDiagnosticText(value.reportDirectory) : null,
      });
    }
    const reportFiles = (await fs.readdir(reportRoot).catch(() => [] as string[])).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse();
    let latestReport: Record<string, unknown> | null = null;
    for (const date of reportFiles) {
      const dateDir = path.join(reportRoot, date);
      const times = (await fs.readdir(dateDir).catch(() => [] as string[])).sort().reverse();
      for (const time of times) {
        const candidate = await readJson(path.join(dateDir, time, 'summary.json'));
        if (candidate) {
          latestReport = {
            runId: candidate.runId ?? null, status: candidate.status ?? candidate.decision ?? null,
            completedAt: candidate.completedAt ?? null, gitHeadSha: candidate.gitHeadSha ?? null,
            reportDirectory: path.relative(root, path.join(dateDir, time)),
          };
          break;
        }
      }
      if (latestReport) break;
    }
    const output = {
      projectRoot: root,
      config: { exists: await fs.access(path.join(configDir, 'config.yaml')).then(() => true, () => false), directory: path.relative(root, configDir) || '.' },
      concurrency: { locked: Boolean(lock), owner: lock ? { runId: lock.runId ?? null, pid: lock.pid ?? null, startedAt: lock.startedAt ?? null } : null,
        lockPath: path.relative(root, lockPath) },
      resumableRuns: runs,
      latestReport,
      notes: ['Read-only inspection; no build, device, or test commands were run.', 'A lock may be stale after a hard process termination; inspect owner metadata before removing it.'],
    };
    return textResult(JSON.stringify(output, null, 2), output as unknown as Record<string, unknown>);
  }));
}

const tool: ToolModule = { toolName, workflow, register };
export default tool;
