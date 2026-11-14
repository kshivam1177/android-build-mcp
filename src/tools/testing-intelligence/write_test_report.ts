import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { writeTestRunReport, type TestRunReport } from '../../testing-intelligence/report.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'write_test_report';
export const workflow = 'testing-intelligence';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Write Test Report',
    description: 'Write a Markdown report and machine-readable JSON results under .testorbit/test-reports/YYYY-MM-DD/<time>-<run-id>. Redacts common secret fields and token values; never infers test success.',
    inputSchema: {
      projectPath: z.string().optional(),
      title: z.string().min(1).max(200),
      summary: z.string().min(1).max(20000),
      resultsJson: z.string().optional().describe('Optional JSON string with test cases, statuses, evidence, and environment details.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; title: string; summary: string; resultsJson?: string }) => {
    const root = path.resolve(args.projectPath ?? process.cwd());
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project directory does not exist: ${root}`);

    let parsed: unknown = {
      status: 'not-provided',
      note: 'No structured results were supplied; this report does not assert test execution or success.',
    };
    if (args.resultsJson?.trim()) parsed = JSON.parse(args.resultsJson);
    const structured = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { structuredResults: parsed };
    const report: TestRunReport = {
      ...structured,
      request: args.title,
      summary: args.summary.trim(),
      projectRoot: root,
    };
    const saved = await writeTestRunReport(root, report);
    return textResult(`Test report saved to ${saved.directory}`, {
      directory: saved.directory,
      report: saved.markdownPath,
      results: saved.jsonPath,
      runId: saved.runId,
    });
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
