import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { AutomationEngine } from '../../platform/engine.js';
import { FileRunCheckpointStore } from '../../platform/checkpoint.js';
import { createPlatformDrivers } from '../../platform/drivers.js';
import { parseAutomationTest } from '../../platform/specification.js';
import { toJunitXml } from '../../platform/reporting/junit.js';
import { redactSensitiveText } from '../../platform/reporting/redaction.js';
import type { ToolModule } from '../types.js';

export const toolName = 'run_cross_platform_test';
export const workflow = 'cross-platform-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Run Cross-Platform Test',
    description: 'Execute one validated test definition across Android, Flutter, iOS and/or Web. Produces redacted JSON, Markdown and JUnit reports with failure evidence under .testorbit/test-reports.',
    inputSchema: {
      testDefinition: z.unknown().describe('Complete schemaVersion 1.0 test definition.'),
      projectPath: z.string().optional().describe('Project root for report output; defaults to the current working directory.'),
      variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Runtime variables. Keep credentials out of the test definition and report.'),
      maxConcurrency: z.number().int().min(1).max(4).optional().describe('Maximum independent platform targets to execute concurrently. Defaults to 2.'),
      runTimeoutMs: z.number().int().min(1000).max(3600000).optional().describe('Optional overall run timeout in milliseconds; active drivers receive cancellation when it expires.'),
      checkpointPath: z.string().optional().describe('Optional project-relative JSON checkpoint path. Reuse the same path with resume=true to continue a run.'),
      resume: z.boolean().optional().default(false).describe('Resume from completed platform checkpoints. Interrupted platforms are not replayed unless explicitly allowed.'),
      restartInterruptedPlatforms: z.boolean().optional().default(false).describe('Explicitly restart platforms that were active when the previous process stopped; may replay non-idempotent actions.')
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, withErrorHandling(async (args: { testDefinition: unknown; projectPath?: string; variables?: Record<string, string | number | boolean>; maxConcurrency?: number; runTimeoutMs?: number; checkpointPath?: string; resume?: boolean; restartInterruptedPlatforms?: boolean }) => {
    const definition = parseAutomationTest(args.testDefinition);
    const projectRoot = resolveProjectRoot(args.projectPath ?? process.cwd());
    const checkpointFile = args.checkpointPath ? path.resolve(projectRoot, args.checkpointPath) : undefined;
    if (checkpointFile) {
      const relative = path.relative(projectRoot, checkpointFile);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('checkpointPath must remain inside the project root.');
    }
    if (args.resume && !checkpointFile) throw new Error('resume=true requires checkpointPath.');
    const result = await new AutomationEngine({ drivers: createPlatformDrivers(), maxConcurrency: args.maxConcurrency }).run(definition, {
      variables: args.variables, maxConcurrency: args.maxConcurrency, timeoutMs: args.runTimeoutMs,
      ...(checkpointFile ? { checkpointStore: new FileRunCheckpointStore(checkpointFile) } : {}),
      resume: args.resume, restartInterruptedPlatforms: args.restartInterruptedPlatforms
    });
    const date = new Date();
    const dateFolder = date.toISOString().slice(0, 10);
    const timeFolder = date.toISOString().slice(11, 19).replace(/:/g, '-') + '-' + randomUUID().slice(0, 8);
    const reportDirectory = path.join(projectRoot, '.testorbit', 'test-reports', dateFolder, timeFolder);
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
    const junitPath = path.join(reportDirectory, 'junit.xml');
    const secrets = Object.values(args.variables ?? {}).filter((value): value is string => typeof value === 'string');
    const jsonText = redactSensitiveText(JSON.stringify(reportResult, null, 2), secrets);
    await fs.writeFile(jsonPath, jsonText, 'utf8');
    const lines = [
      '# Cross-platform test report', '',
      '- Test: ' + result.testId,
      '- Run: ' + result.runId,
      '- Result: ' + (result.success ? 'PASSED' : result.timedOut ? 'TIMED OUT' : result.cancelled ? 'CANCELLED' : 'FAILED'),
      '- Duration: ' + result.durationMs + ' ms',
      '- Platforms: ' + result.summary.passedPlatforms + ' passed; ' + result.summary.failedPlatforms + ' failed; ' + result.summary.cancelledPlatforms + ' cancelled',
      '- Steps: ' + result.summary.totalSteps + ' total; ' + result.summary.failedSteps + ' failed; ' + result.summary.retriedSteps + ' retried',
      '- Attempts: ' + result.summary.totalAttempts, '',
      '## Platform results', ''
    ];
    for (const platform of reportResult.platforms) {
      lines.push('### ' + platform.platform + ': ' + (platform.status === 'cancelled' ? 'CANCELLED' : platform.success ? 'PASSED' : 'FAILED'));
      lines.push('- Duration: ' + platform.durationMs + ' ms');
      if (platform.error) lines.push('- Error: ' + platform.error);
      if (platform.evidence && 'screenshotPath' in platform.evidence && platform.evidence.screenshotPath) lines.push('- Screenshot evidence: ' + path.basename(String(platform.evidence.screenshotPath)));
      if (platform.evidence?.snapshot) lines.push('- Accessibility snapshot captured: ' + platform.evidence.capturedAt);
      for (const step of platform.steps) {
        lines.push('- [' + step.status.toUpperCase() + '] ' + step.id + ' (' + step.durationMs + ' ms; attempts: ' + (step.attempts ?? 1) + ')' + (step.error ? ': ' + step.error : ''));
      }
      lines.push('');
    }
    await fs.writeFile(markdownPath, redactSensitiveText(lines.join('\n'), secrets), 'utf8');
    await fs.writeFile(junitPath, redactSensitiveText(toJunitXml(result), secrets), 'utf8');
    const summary = {
      success: result.success, cancelled: result.cancelled, timedOut: result.timedOut, testId: result.testId, runId: result.runId,
      summary: result.summary,
      platforms: reportResult.platforms.map((platform) => ({ platform: platform.platform, status: platform.status ?? (platform.success ? 'passed' : 'failed'), success: platform.success, durationMs: platform.durationMs, error: platform.error, evidence: platform.evidence ? true : false })),
      reportDirectory, jsonReport: jsonPath, markdownReport: markdownPath, junitReport: junitPath
    };
    return textResult(JSON.stringify(summary, null, 2), summary);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
