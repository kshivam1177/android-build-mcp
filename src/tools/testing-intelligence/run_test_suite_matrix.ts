import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfigDir } from '../../config/loader.js';
import { execCommand } from '../../utils/exec.js';
import { runGradle } from '../../utils/gradle.js';
import { resolveTarget } from '../../utils/adb.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { detectTestPlatform, planSafeTestCommand, type TestPlatform } from '../../testing-intelligence/safeTestExecution.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'run_test_suite_matrix';
export const workflow = 'testing-intelligence';
type Suite = 'unit' | 'integration';
type SuiteResult = { suite: Suite; status: 'passed' | 'failed' | 'blocked' | 'unavailable'; command: string | null; exitCode: number | null; durationMs: number; error?: string; stdout?: string; stderr?: string };

function redact(value: string): string {
  return value
    .replace(/(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]');
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

async function gitValue(root: string, args: string[]): Promise<string | null> {
  try {
    const result = await execCommand('git', args, { cwd: root, timeoutMs: 5000 });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  } catch { return null; }
}

function modulePath(root: string, module?: string): string {
  const value = (module ?? '').trim().replace(/^:+|:+$/g, '');
  if (!value) return root;
  if (!/^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*$/.test(value)) throw new Error('Module contains unsupported characters.');
  return path.join(root, ...value.split(':'));
}

async function suiteAvailable(root: string, platform: TestPlatform, suite: Suite, module?: string): Promise<{ available: boolean; evidence: string }> {
  if (platform === 'flutter') {
    if (suite === 'unit') {
      const available = await exists(path.join(root, 'test'));
      return { available, evidence: available ? 'test/ exists' : 'test/ not found' };
    }
    const available = await exists(path.join(root, 'integration_test'));
    return { available, evidence: available ? 'integration_test/ exists' : 'integration_test/ not found' };
  }
  const base = modulePath(root, module);
  if (suite === 'unit') {
    const candidates = [path.join(base, 'src', 'test'), path.join(base, 'src', 'testDebug')];
    const available = (await Promise.all(candidates.map(exists))).some(Boolean);
    return { available, evidence: available ? 'conventional Gradle unit-test source set found' : 'no conventional src/test source set found' };
  }
  const candidates = [path.join(base, 'src', 'androidTest'), path.join(base, 'src', 'androidTestDebug')];
  const available = (await Promise.all(candidates.map(exists))).some(Boolean);
  return { available, evidence: available ? 'conventional androidTest source set found' : 'no conventional androidTest source set found' };
}

export function summarizeMatrixResults(results: SuiteResult[]) {
  const passed = results.filter(item => item.status === 'passed').length;
  const failed = results.filter(item => item.status === 'failed').length;
  const blocked = results.filter(item => item.status === 'blocked').length;
  const unavailable = results.filter(item => item.status === 'unavailable').length;
  const skipped = blocked + unavailable;
  const status = failed > 0 ? 'failed' : results.length === 0 || passed === 0 || skipped > 0 ? 'incomplete' : 'passed';
  return { status, testCount: results.length, passed, failed, skipped, blocked, unavailable };
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Run Safe Project Test Suite Matrix',
    description: 'Plan or sequentially execute the available project-native Flutter or Android Gradle unit/integration suites. Preview is default; execute=true is required to run commands. Each suite result and bounded, redacted output is saved with commit provenance. Saved UI test cases remain a separate workflow and must be consolidated independently.',
    inputSchema: {
      projectPath: z.string().optional(),
      platform: z.enum(['flutter', 'android-gradle']).optional(),
      suites: z.array(z.enum(['unit', 'integration'])).min(1).max(2).optional().default(['unit']),
      module: z.string().optional().describe('Optional Gradle module path, such as app or feature:login.'),
      variant: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).optional().default('debug'),
      targetId: z.string().optional(),
      execute: z.boolean().optional().default(false),
      timeoutMs: z.number().int().min(1000).max(1800000).optional().default(900000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; platform?: TestPlatform; suites?: Suite[]; module?: string; variant?: string; targetId?: string; execute?: boolean; timeoutMs?: number }) => {
    const root = args.projectPath ? path.resolve(args.projectPath) : resolveProjectRoot(path.resolve(process.cwd()));
    const platform = args.platform ?? detectTestPlatform(root);
    if (!platform) throw new Error('No supported Flutter pubspec.yaml or Gradle settings file found at the selected project root.');
    const suites: Suite[] = [...new Set<Suite>(args.suites ?? ['unit'])];
    const matrix: Array<{ suite: Suite; available: boolean; evidence: string; commandPlan: ReturnType<typeof planSafeTestCommand> | null }> = [];
    for (const suite of suites) {
      const availability = await suiteAvailable(root, platform, suite, args.module);
      let commandPlan: ReturnType<typeof planSafeTestCommand> | null = null;
      if (availability.available) {
        commandPlan = planSafeTestCommand({ projectRoot: root, platform, suite, targetId: args.targetId, module: args.module, variant: args.variant ?? 'debug' });
      }
      matrix.push({ suite, ...availability, commandPlan });
    }
    const gitHeadSha = await gitValue(root, ['rev-parse', 'HEAD']);
    const statusPorcelain = await gitValue(root, ['status', '--porcelain']);
    const workingTreeClean = statusPorcelain === null ? null : statusPorcelain.length === 0;
    const dirtyPaths = statusPorcelain === null ? [] : statusPorcelain.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim()).filter(Boolean).slice(0, 200);
    const warnings: string[] = [];
    if (!gitHeadSha) warnings.push('Git HEAD could not be captured before execution; commit-bound provenance is unavailable.');
    if (workingTreeClean === false) warnings.push('Working tree has uncommitted changes. The Git HEAD SHA alone does not identify those changes.');
    if (matrix.some(item => !item.available)) warnings.push('One or more requested suites are unavailable; unavailable suites will be recorded as skipped, not passed.');

    if (!args.execute) {
      const preview = { mode: 'plan-only', status: matrix.some(item => item.available) ? 'ready-for-review' : 'incomplete', projectRoot: root, platform, matrix, gitHeadSha, workingTreeClean, dirtyPaths, warnings, executionRequires: 'Review each command plan, then set execute=true to run the selected available suites sequentially.' };
      return textResult(JSON.stringify(preview, null, 2), preview as unknown as Record<string, unknown>);
    }

    let target: Awaited<ReturnType<typeof resolveTarget>> | undefined;
    let targetError: string | undefined;
    if (matrix.some(item => item.suite === 'integration' && item.available)) {
      try { target = await resolveTarget({ requestedId: args.targetId }); }
      catch (error) { targetError = redact(error instanceof Error ? error.message : String(error)); warnings.push('Device integration suite blocked: ' + targetError); }
    }
    const executionStartedAt = new Date().toISOString();
    const results: SuiteResult[] = [];
    for (const item of matrix) {
      if (!item.available || !item.commandPlan) {
        results.push({ suite: item.suite, status: 'unavailable', command: null, exitCode: null, durationMs: 0, error: item.evidence });
        continue;
      }
      if (item.suite === 'integration' && !target) {
        results.push({ suite: item.suite, status: 'blocked', command: item.commandPlan.executable + ' ' + item.commandPlan.args.join(' '), exitCode: null, durationMs: 0, error: targetError ?? 'A ready device target is required.' });
        continue;
      }
      const started = Date.now();
      const plan = item.commandPlan;
      let command = plan.executable + ' ' + plan.args.join(' ');
      try {
        let exitCode: number;
        let stdout: string;
        let stderr: string;
        if (platform === 'flutter') {
          const argv = item.suite === 'unit' ? ['test'] : ['test', '-d', target!.id, 'integration_test'];
          const executable = process.env.FLUTTER_PATH || 'flutter';
          command = executable + ' ' + argv.join(' ');
          const run = await execCommand(executable, argv, { cwd: root, timeoutMs: args.timeoutMs ?? 900000 });
          exitCode = run.exitCode; stdout = run.stdout; stderr = run.stderr;
        } else {
          const module = (args.module ?? '').trim().replace(/^:+|:+$/g, '');
          const prefix = module ? ':' + module + ':' : '';
          const variant = args.variant ?? 'debug';
          const cap = variant[0]!.toUpperCase() + variant.slice(1);
          const task = item.suite === 'unit' ? 'test' + cap + 'UnitTest' : 'connected' + cap + 'AndroidTest';
          command = 'Gradle ' + prefix + task + ' --console=plain';
          const run = await runGradle(root, [prefix + task], { timeoutMs: args.timeoutMs ?? 900000, env: target ? { ANDROID_SERIAL: target.id } : undefined });
          exitCode = run.exitCode; stdout = run.stdout; stderr = run.stderr;
        }
        results.push({ suite: item.suite, status: exitCode === 0 ? 'passed' : 'failed', command, exitCode, durationMs: Date.now() - started, stdout: redact(stdout).slice(-20000), stderr: redact(stderr).slice(-20000) });
      } catch (error) {
        const value = error as { message?: string; details?: Record<string, unknown> };
        const message = redact(value.message ?? String(error));
        const details = value.details ?? {};
        const environmentFailure = /not found|not installed|no such file|sdk location|no devices|device.*not found|cannot find|no (connected )?(target|emulator|device)|multiple targets|target offline|target unauthorized|not in state/i.test(message);
        results.push({
          suite: item.suite, status: environmentFailure ? 'blocked' : 'failed', command,
          exitCode: typeof details.exitCode === 'number' ? details.exitCode : null, durationMs: Date.now() - started,
          error: message,
          stdout: typeof details.stdout === 'string' ? redact(details.stdout).slice(-20000) : '',
          stderr: typeof details.stderr === 'string' ? redact(details.stderr).slice(-20000) : '',
        });
      }
    }

    const counts = summarizeMatrixResults(results);
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const reportDir = path.join(getConfigDir(root), 'test-reports', date, time + '-matrix-' + randomUUID().slice(0, 8));
    await fs.mkdir(reportDir, { recursive: true });
    const summary = {
      schemaVersion: 1, workflow: 'test-suite-matrix', mode: 'execute', generatedAt: now.toISOString(),
      startedAt: executionStartedAt,
      projectRoot: root, platform, gitHeadSha, workingTreeClean, dirtyPaths, ...counts,
      sourceReportCount: 1, sourceReportsWithHeadSha: gitHeadSha ? 1 : 0, sourceReportsWithoutHeadSha: gitHeadSha ? 0 : 1,
      tests: results.map(row => ({ name: row.suite, status: row.status === 'passed' ? 'passed' : row.status === 'failed' ? 'failed' : 'skipped', durationMs: row.durationMs, message: row.error ?? row.stderr ?? row.status, sourceReport: 'matrix', evidence: row.command ? [row.command] : [] })),
      results, warnings,
      limitations: ['Saved UI test cases are not executed by this tool; run_test_workflow remains separate.', 'A dirty working tree means commit SHA provenance does not fingerprint uncommitted content.', 'A suite result is based on the native runner exit status, not parsed individual test-case counts.'],
    };
    await fs.writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await fs.writeFile(path.join(reportDir, 'report.json'), JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await fs.writeFile(path.join(reportDir, 'summary.md'), [
      '# TestOrbit Test Suite Matrix', '',
      '- **Status:** ' + counts.status.toUpperCase(),
      '- **Platform:** ' + platform,
      '- **Git HEAD:** ' + (gitHeadSha ?? 'UNAVAILABLE'),
      '- **Working tree clean:** ' + String(workingTreeClean),
      '- **Passed suites:** ' + counts.passed,
      '- **Failed suites:** ' + counts.failed,
      '- **Skipped / unavailable suites:** ' + counts.skipped,
      '', '## Results',
      ...results.map(row => '- **' + row.status.toUpperCase() + '** — ' + row.suite + (row.command ? ': ' + row.command : '') + (row.error ? ' — ' + row.error : '')),
      '', '## Warnings', ...(warnings.length ? warnings.map(item => '- ' + item) : ['- None']), '',
    ].join('\n'), { encoding: 'utf8', flag: 'wx' });
    const output = { ...counts, projectRoot: root, platform, gitHeadSha, workingTreeClean, dirtyPaths, reportDirectory: path.relative(root, reportDir).split(path.sep).join('/'), summaryJson: path.relative(root, path.join(reportDir, 'summary.json')).split(path.sep).join('/'), summaryMarkdown: path.relative(root, path.join(reportDir, 'summary.md')).split(path.sep).join('/'), results, warnings };
    return textResult(JSON.stringify(output, null, 2), output as unknown as Record<string, unknown>);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
