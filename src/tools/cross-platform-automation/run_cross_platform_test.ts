import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { AutomationEngine } from '../../platform/engine.js';
import { createPlatformDrivers } from '../../platform/drivers.js';
import { parseAutomationTest } from '../../platform/specification.js';
import type { ToolModule } from '../types.js';

export const toolName = 'run_cross_platform_test';
export const workflow = 'cross-platform-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Run Cross-Platform Test',
    description: 'Execute one validated test definition against Android, Flutter, iOS and/or Web drivers. Produces JSON and Markdown reports under .androidmcp-framework/test-reports.',
    inputSchema: {
      testDefinition: z.unknown().describe('Complete schemaVersion 1.0 test definition.'),
      projectPath: z.string().optional().describe('Project root for report output; defaults to the current working directory.'),
      variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Runtime variables. Keep credentials out of the test definition and report.')
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, withErrorHandling(async (args: { testDefinition: unknown; projectPath?: string; variables?: Record<string, string | number | boolean> }) => {
    const definition = parseAutomationTest(args.testDefinition);
    const projectRoot = resolveProjectRoot(args.projectPath ?? process.cwd());
    const result = await new AutomationEngine({ drivers: createPlatformDrivers() }).run(definition, { variables: args.variables });
    const date = new Date();
    const dateFolder = date.toISOString().slice(0, 10);
    const timeFolder = date.toISOString().slice(11, 19).replace(/:/g, '-') + '-' + randomUUID().slice(0, 8);
    const reportDirectory = path.join(projectRoot, '.androidmcp-framework', 'test-reports', dateFolder, timeFolder);
    await fs.mkdir(reportDirectory, { recursive: true });
    const reportResult = {
      ...result,
      platforms: await Promise.all(result.platforms.map(async (platform) => {
        if (!platform.evidence) return platform;
        let screenshotPath: string | undefined;
        if (platform.evidence.screenshot) {
          screenshotPath = path.join(reportDirectory, 'evidence-' + platform.platform + '.png');
          await fs.writeFile(screenshotPath, Buffer.from(platform.evidence.screenshot.base64, 'base64'));
        }
        return {
          ...platform,
          evidence: {
            capturedAt: platform.evidence.capturedAt,
            ...(screenshotPath ? { screenshotPath } : {}),
            ...(platform.evidence.snapshot ? { snapshot: platform.evidence.snapshot } : {})
          }
        };
      }))
    };
    const jsonPath = path.join(reportDirectory, 'cross-platform-report.json');
    const markdownPath = path.join(reportDirectory, 'cross-platform-report.md');
    await fs.writeFile(jsonPath, JSON.stringify(reportResult, null, 2), 'utf8');
    const lines = [
      '# Cross-platform test report', '',
      '- Test: ' + result.testId,
      '- Run: ' + result.runId,
      '- Result: ' + (result.success ? 'PASSED' : 'FAILED'),
      '- Duration: ' + result.durationMs + ' ms', '',
      '## Platform results', ''
    ];
    for (const platform of result.platforms) {
      lines.push('### ' + platform.platform + ': ' + (platform.success ? 'PASSED' : 'FAILED'));
      lines.push('- Duration: ' + platform.durationMs + ' ms');
      if (platform.error) lines.push('- Error: ' + platform.error);
      if (platform.evidence?.screenshot) lines.push('- Screenshot evidence: evidence-' + platform.platform + '.png');
      if (platform.evidence?.snapshot) lines.push('- Accessibility snapshot captured: ' + platform.evidence.capturedAt);
      for (const step of platform.steps) {
        lines.push('- [' + step.status.toUpperCase() + '] ' + step.id + ' (' + step.durationMs + ' ms)' + (step.error ? ': ' + step.error : ''));
      }
      lines.push('');
    }
    await fs.writeFile(markdownPath, lines.join('\n'), 'utf8');
    const summary = {
      success: result.success, testId: result.testId, runId: result.runId,
      platforms: reportResult.platforms.map((platform) => ({ platform: platform.platform, success: platform.success, durationMs: platform.durationMs, error: platform.error, evidence: platform.evidence ? true : false })),
      reportDirectory, jsonReport: jsonPath, markdownReport: markdownPath
    };
    return textResult(JSON.stringify(summary, null, 2), summary);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
