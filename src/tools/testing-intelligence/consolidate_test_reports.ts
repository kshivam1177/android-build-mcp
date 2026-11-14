import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfigDir } from '../../config/loader.js';
import { buildJUnitXml, buildSummary, buildSummaryMarkdown, normalizeReport, type ConsolidatedTest } from '../../testing-intelligence/reportConsolidation.js';
import { redactSecrets } from '../../testing-intelligence/report.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import type { ToolModule } from '../types.js';

export const toolName = 'consolidate_test_reports';
export const workflow = 'testing-intelligence';
const REPORT_NAMES = new Set(['report.json', 'results.json', 'workflow-report.json', 'replay-report.json']);

async function findReports(root: string, current = root, results: string[] = []): Promise<string[]> {
  let entries;
  try { entries = await fs.readdir(current, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return results;
    throw error;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await findReports(root, absolute, results);
    else if (entry.isFile() && REPORT_NAMES.has(entry.name)) results.push(absolute);
  }
  return results;
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Consolidate Test Reports for CI',
    description: 'Consolidate recognized TestOrbit workflow, replay, saved-test-case, and standard report JSON files into a truthful Markdown summary, machine-readable JSON, and JUnit XML. Only explicit passing statuses count as passed; missing outcomes become skipped and an empty report set is marked no-data.',
    inputSchema: {
      projectPath: z.string().optional(),
      since: z.string().datetime().optional().describe('Optional ISO timestamp; include reports whose file modification time is at or after this instant.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; since?: string }) => {
    const projectRoot = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const configDir = getConfigDir(projectRoot);
    const reportsRoot = path.join(configDir, 'test-reports');
    const warnings: string[] = [];
    const allFiles = await findReports(reportsRoot);
    const sinceMs = args.since ? Date.parse(args.since) : undefined;
    const selectedFiles: string[] = [];
    for (const file of allFiles) {
      const metadata = await fs.stat(file);
      if (sinceMs !== undefined && metadata.mtimeMs < sinceMs) continue;
      selectedFiles.push(file);
    }
    const tests: ConsolidatedTest[] = [];
    const sourceHeadShas: Array<string | null> = [];
    let parsedReportCount = 0;
    for (const file of selectedFiles) {
      const relative = path.relative(projectRoot, file).split(path.sep).join('/');
      try {
        const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
        const sanitized = redactSecrets(value);
        tests.push(...normalizeReport(relative, sanitized));
        const reportValue = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized as Record<string, unknown> : {};
        const sourceSha = typeof reportValue.gitHeadSha === 'string' && /^[a-f0-9]{40,64}$/i.test(reportValue.gitHeadSha) ? reportValue.gitHeadSha : null;
        sourceHeadShas.push(sourceSha);
        parsedReportCount += 1;
      } catch {
        warnings.push(`Could not parse report JSON: ${relative}`);
      }
    }
    const distinctHeads = [...new Set(sourceHeadShas.filter((sha): sha is string => sha !== null))];
    const reportsWithHeadSha = sourceHeadShas.filter(Boolean).length;
    const reportsWithoutHeadSha = parsedReportCount - reportsWithHeadSha;
    const gitHeadSha = parsedReportCount > 0 && reportsWithoutHeadSha === 0 && distinctHeads.length === 1 ? distinctHeads[0]! : null;
    if (reportsWithoutHeadSha > 0) warnings.push(`${reportsWithoutHeadSha} source report(s) lack a Git HEAD SHA; the consolidated result cannot prove commit-bound coverage.`);
    if (distinctHeads.length > 1) warnings.push('Source reports were produced from multiple Git HEAD SHAs; the consolidated result cannot prove coverage of one commit.');
    const summary = buildSummary(tests, parsedReportCount, warnings, new Date().toISOString(), { gitHeadSha, sourceReportsWithHeadSha: reportsWithHeadSha, sourceReportsWithoutHeadSha: reportsWithoutHeadSha });
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const outputDir = path.join(reportsRoot, date, `${time}-summary-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(outputDir, { recursive: true });
    const summaryJson = path.join(outputDir, 'summary.json');
    const summaryMarkdown = path.join(outputDir, 'summary.md');
    const junitXml = path.join(outputDir, 'junit.xml');
    await Promise.all([
      fs.writeFile(summaryJson, JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }),
      fs.writeFile(summaryMarkdown, buildSummaryMarkdown(summary), { encoding: 'utf8', flag: 'wx' }),
      fs.writeFile(junitXml, buildJUnitXml(summary), { encoding: 'utf8', flag: 'wx' }),
    ]);
    const result = {
      status: summary.status,
      sourceReportCount: summary.sourceReportCount,
      testCount: summary.testCount,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      gitHeadSha: summary.gitHeadSha,
      sourceReportsWithHeadSha: summary.sourceReportsWithHeadSha,
      sourceReportsWithoutHeadSha: summary.sourceReportsWithoutHeadSha,
      summaryJson: path.relative(projectRoot, summaryJson).split(path.sep).join('/'),
      summaryMarkdown: path.relative(projectRoot, summaryMarkdown).split(path.sep).join('/'),
      junitXml: path.relative(projectRoot, junitXml).split(path.sep).join('/'),
      warnings: summary.warnings,
      ciPolicy: 'Fail CI when status is failed, incomplete, or no-data unless the pipeline explicitly allows skipped tests; skipped outcomes are not passes.',
    };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
