import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { execCommand } from '../../utils/exec.js';
import { runGradle } from '../../utils/gradle.js';
import { resolveTarget } from '../../utils/adb.js';
import { writeTestRunReport } from '../../testing-intelligence/report.js';
import { detectTestPlatform, planSafeTestCommand } from '../../testing-intelligence/safeTestExecution.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'run_project_tests';
export const workflow = 'testing-intelligence';

function redactCommandOutput(value: string): string {
  return value
    .replace(/(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]');
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Run Safe Project-Native Tests',
    description: 'Detect and reuse Flutter or Native Android test runners. Preview is the default; execution requires execute=true. Only framework-defined test tasks are invoked, never arbitrary model-provided shell commands. Writes Markdown/JSON reports plus a bounded command log under .testorbit/test-reports/.',
    inputSchema: {
      projectPath: z.string().optional(),
      suite: z.enum(['unit', 'integration']).optional().default('unit'),
      platform: z.enum(['flutter', 'android-gradle']).optional(),
      module: z.string().optional().describe('Optional native Gradle module path, e.g. app or feature:login.'),
      variant: z.string().optional().default('debug'),
      targetId: z.string().optional(),
      execute: z.boolean().optional().default(false).describe('False previews the supported test command. Set true only after reviewing the project and suite.'),
      timeoutMs: z.number().int().min(1000).max(1800000).optional().default(900000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: {
    projectPath?: string; suite?: 'unit' | 'integration'; platform?: 'flutter' | 'android-gradle';
    module?: string; variant?: string; targetId?: string; execute?: boolean; timeoutMs?: number;
  }) => {
    // An explicit projectPath is authoritative: monorepo package paths must not be promoted to the Git root.
    const root = args.projectPath ? path.resolve(args.projectPath) : resolveProjectRoot(path.resolve(process.cwd()));
    const suite = args.suite ?? 'unit';
    const detected = args.platform ?? detectTestPlatform(root);
    const plan = planSafeTestCommand({ projectRoot: root, platform: detected, suite, targetId: args.targetId, module: args.module, variant: args.variant ?? 'debug' });
    if (!args.execute) {
      const result = { mode: 'plan-only', status: 'ready-for-review', plan, executionRequires: 'Set execute=true after reviewing the selected project and suite.' };
      return textResult(JSON.stringify(result, null, 2), result);
    }
    const started = Date.now();
    let target: Awaited<ReturnType<typeof resolveTarget>> | undefined;
    let exitCode: number | null = null;
    let stdout = '';
    let stderr = '';
    let command = plan.executable + ' ' + plan.args.join(' ');
    let executionError: string | undefined;
    let environmentFailure = false;
    try {
      if (suite === 'integration') target = await resolveTarget({ requestedId: args.targetId });
      if (plan.platform === 'flutter') {
        const argsList = suite === 'unit' ? ['test'] : ['test', '-d', target!.id, 'integration_test'];
        command = (process.env.FLUTTER_PATH || 'flutter') + ' ' + argsList.join(' ');
        const result = await execCommand(process.env.FLUTTER_PATH || 'flutter', argsList, { cwd: root, timeoutMs: args.timeoutMs ?? 900000 });
        exitCode = result.exitCode; stdout = result.stdout; stderr = result.stderr;
      } else {
        const module = (args.module ?? '').trim().replace(/^:+|:+$/g, '');
        const prefix = module ? ':' + module + ':' : '';
        const variant = args.variant ?? 'debug';
        const cap = variant[0]!.toUpperCase() + variant.slice(1);
        const task = suite === 'unit' ? 'test' + cap + 'UnitTest' : 'connected' + cap + 'AndroidTest';
        command = 'Gradle ' + prefix + task + ' --console=plain';
        const result = await runGradle(root, [prefix + task], {
          timeoutMs: args.timeoutMs ?? 900000,
          env: target ? { ANDROID_SERIAL: target.id } : undefined,
        });
        exitCode = result.exitCode; stdout = result.stdout; stderr = result.stderr;
      }
    } catch (error) {
      const value = error as { message?: string; details?: Record<string, unknown> };
      executionError = value.message ?? String(error);
      const details = value.details ?? {};
      exitCode = typeof details.exitCode === 'number' ? details.exitCode : null;
      stdout = typeof details.stdout === 'string' ? details.stdout : '';
      stderr = typeof details.stderr === 'string' ? details.stderr : '';
      environmentFailure = /not found|not installed|no such file|sdk location|no devices|device.*not found|cannot find|no (connected )?(target|emulator|device)|multiple targets|target.*not found|target offline|target unauthorized|not in state/i.test(executionError);
    }
    const status = environmentFailure ? 'blocked' : exitCode === 0 ? 'passed' : 'failed';
    const safeError = executionError ? redactCommandOutput(executionError) : undefined;
    const safeStdout = redactCommandOutput(stdout);
    const safeStderr = redactCommandOutput(stderr);
    const report = await writeTestRunReport(root, {
      request: 'Project-native ' + plan.platform + ' ' + suite + ' tests',
      platform: plan.platform,
      ...(target ? { device: target.id } : {}),
      selectedTests: [{ name: suite, reason: plan.rationale }],
      steps: [{ name: command, status: status === 'passed' ? 'passed' : status === 'blocked' ? 'blocked' : 'failed', durationMs: Date.now() - started, details: safeError ?? ('Exit code: ' + String(exitCode)) }],
      errors: safeError ? [safeError, safeStderr.slice(-4000)] : safeStderr ? [safeStderr.slice(-4000)] : [],
      limitations: ['The command log is bounded to the last 20,000 characters per output stream.'],
    });
    const logPath = path.join(report.directory, 'command.log');
    await fs.writeFile(logPath, ['COMMAND: ' + command, 'EXIT_CODE: ' + String(exitCode), '', '--- STDOUT ---', safeStdout.slice(-20000), '', '--- STDERR ---', safeStderr.slice(-20000), safeError ? '\n--- ERROR ---\n' + safeError : ''].join('\n'), { encoding: 'utf8', flag: 'wx' });
    const result = {
      mode: 'execute', status, platform: plan.platform, suite, command, exitCode, durationMs: Date.now() - started,
      environmentFailure, report: path.relative(root, report.directory).split(path.sep).join('/'),
      reportMarkdown: path.relative(root, report.markdownPath).split(path.sep).join('/'),
      reportJson: path.relative(root, report.jsonPath).split(path.sep).join('/'),
      commandLog: path.relative(root, logPath).split(path.sep).join('/'),
      error: safeError,
    };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
