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
import { detectTestPlatform, type TestPlatform } from '../../testing-intelligence/safeTestExecution.js';
import { evaluateUnifiedGate, isRetryableTransient, selectResumableWork, type UnifiedWorkResult } from '../../testing-intelligence/unifiedRun.js';
import { resolveTargetAndBackend } from '../ui-automation/_shared.js';
import { findNodesByTarget } from './run_test_case.js';
import { parseUiHierarchy } from '../../automation/uiHierarchy.js';
import { waitForUiAssertion } from '../../automation/waitForUiAssertion.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';
import type { UiNode } from '../../types.js';
import { acquireProjectRunLock, classifyRuntimeError, redactDiagnosticText } from '../../testing-intelligence/runtimeSafety.js';

export const toolName = 'run_unified_test_run';
export const workflow = 'testing-intelligence';
type Suite = 'unit' | 'integration';
type StoredCase = { id?: string; title?: string; name?: string; steps?: unknown[]; [key: string]: unknown };
type Manifest = {
  schemaVersion: 1; runId: string; projectRoot: string; gitHeadSha: string | null; workingTreeClean: boolean | null;
  startedAt: string; updatedAt: string; reportDirectory: string; targetId?: string; platform: TestPlatform;
  module?: string; variant: string; requestedSuites: Suite[]; includeSavedUiTests: boolean; work: UnifiedWorkResult[]; warnings: string[];
};
const redact = (s: string) => redactDiagnosticText(s);
const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'item';
async function gitValue(root: string, args: string[]): Promise<string | null> { try { const r = await execCommand('git', args, { cwd: root, timeoutMs: 5000 }); return r.exitCode === 0 ? r.stdout.trim() : null; } catch { return null; } }
async function exists(file: string): Promise<boolean> { try { await fs.access(file); return true; } catch { return false; } }
function modulePath(root: string, module?: string): string { const v = (module ?? '').trim().replace(/^:+|:+$/g, ''); if (!v) return root; if (!/^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*$/.test(v)) throw new Error('Module contains unsupported characters.'); return path.join(root, ...v.split(':')); }
async function suiteAvailable(root: string, platform: TestPlatform, suite: Suite, module?: string): Promise<boolean> {
  if (platform === 'flutter') return exists(path.join(root, suite === 'unit' ? 'test' : 'integration_test'));
  const base = modulePath(root, module);
  const dirs = suite === 'unit' ? ['src/test', 'src/testDebug'] : ['src/androidTest', 'src/androidTestDebug'];
  const found = await Promise.all(dirs.map((d) => exists(path.join(base, d)))); return found.some(Boolean);
}
async function loadCases(dir: string): Promise<StoredCase[]> {
  let files: string[]; try { files = (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const out: StoredCase[] = [];
  for (const f of files) try { const v: unknown = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) out.push({ ...(v as StoredCase), id: (v as StoredCase).id ?? path.basename(f, '.json') }); } catch { /* invalid saved case is excluded */ }
  return out;
}
async function saveManifest(config: string, m: Manifest): Promise<void> {
  m.updatedAt = new Date().toISOString(); const dir = path.join(config, 'test-reports', '.runs'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, m.runId + '.json'), JSON.stringify(m, null, 2) + '\n', 'utf8');
}
async function failureEvidence(root: string, dir: string, id: string, target: string, backend: Awaited<ReturnType<typeof resolveTargetAndBackend>>['backend']): Promise<string[]> {
  const evidence: string[] = []; const out = path.join(dir, 'evidence'); await fs.mkdir(out, { recursive: true });
  try { const shot = await backend.screenshot(target); const f = path.join(out, slug(id) + '-' + Date.now() + '.png'); await fs.writeFile(f, shot.data); evidence.push(rel(root, f)); } catch { /* best effort */ }
  try { const logs = await execCommand(process.env.ADB_PATH || 'adb', ['-s', target, 'logcat', '-d', '-t', '500'], { cwd: root, timeoutMs: 10000 }); const f = path.join(out, slug(id) + '-logcat.txt'); await fs.writeFile(f, redact(logs.stdout + '\n' + logs.stderr).slice(-30000), 'utf8'); evidence.push(rel(root, f)); } catch { /* best effort */ }
  return evidence;
}
async function runCase(root: string, reportDir: string, target: string, backend: Awaited<ReturnType<typeof resolveTargetAndBackend>>['backend'], testCase: StoredCase, item: UnifiedWorkResult, assertionTimeout: number): Promise<void> {
  const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
  if (!steps.length) { item.status = 'incomplete'; item.error = 'Saved test case has no executable steps.'; return; }
  for (let i = item.completedSteps ?? 0; i < steps.length; i++) {
    const raw = steps[i]; if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { item.status = 'failed'; item.error = 'Malformed step at index ' + i; break; }
    const step = raw as Record<string, unknown>; const action = typeof step.action === 'string' ? step.action.toLowerCase() : 'tap';
    const targetText = typeof step.target === 'string' ? step.target : ''; const description = typeof step.description === 'string' ? step.description : 'Step ' + (i + 1); const started = Date.now();
    try {
      if (action === 'wait_for_ui' || action === 'wait') await new Promise((resolve) => setTimeout(resolve, typeof step.durationMs === 'number' ? Math.max(0, Math.min(step.durationMs, 30000)) : 1000));
      else if (action === 'key_press' || action === 'button') await backend.keyEvent(target, typeof step.key === 'string' ? step.key : '4');
      else if (action === 'type_text') {
        const value = typeof step.text === 'string' ? step.text : typeof step.value === 'string' ? step.value : '';
        if (targetText.trim()) { const nodes = parseUiHierarchy(await backend.dumpHierarchy(target)); const matches = findNodesByTarget(nodes, targetText); if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous target "' + targetText + '".' : 'Could not locate target "' + targetText + '".'); await backend.tap(target, matches[0]!.centerX, matches[0]!.centerY); }
        if (!value) throw new Error('type_text step has no saved text/value.'); await backend.typeText(target, value);
      } else if (action === 'tap') {
        const coords = targetText.match(/^\s*\(?\s*(\d+)\s*,\s*(\d+)\s*\)?\s*$/);
        if (coords) await backend.tap(target, Number(coords[1]), Number(coords[2]));
        else { const nodes: UiNode[] = parseUiHierarchy(await backend.dumpHierarchy(target)); const matches = findNodesByTarget(nodes, targetText || description); if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous target "' + (targetText || description) + '".' : 'Could not locate target "' + (targetText || description) + '".'); await backend.tap(target, matches[0]!.centerX, matches[0]!.centerY); }
      } else throw new Error('Unsupported action "' + action + '". Supported: tap, type_text, key_press, button, wait_for_ui.');
      const expected = typeof step.expectedOutcome === 'string' ? step.expectedOutcome.trim() : '';
      if (expected) { const assertion = await waitForUiAssertion(async () => parseUiHierarchy(await backend.dumpHierarchy(target)), expected, assertionTimeout); if (!assertion.passed) throw new Error('UI assertion failed: ' + assertion.assertion.message); }
      item.completedSteps = i + 1; item.durationMs += Date.now() - started;
    } catch (e) { item.status = 'failed'; item.error = redact(e instanceof Error ? e.message : String(e)); item.durationMs += Date.now() - started; item.evidence = await failureEvidence(root, reportDir, item.id + '-step-' + (i + 1), target, backend); return; }
  }
  item.status = item.completedSteps === steps.length ? 'passed' : 'incomplete';
}
export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Run Unified End-to-End Test Run',
    description: 'Coordinate native Android/Flutter suites and saved UI test cases under one durable run ID. Preview is default; execute=true opts into test commands and device actions. Writes resumable state, bounded transient retries for native suites only, screenshots/logcat on UI failures, one final report, and a strict evidence gate.',
    inputSchema: {
      projectPath: z.string().optional(), platform: z.enum(['flutter', 'android-gradle']).optional(),
      suites: z.array(z.enum(['unit', 'integration'])).min(1).max(2).optional().default(['unit']),
      module: z.string().optional(), variant: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).optional(), targetId: z.string().optional(),
      includeSavedUiTests: z.boolean().optional().default(true), testCaseIds: z.array(z.string().min(1).max(100)).max(30).optional(),
      execute: z.boolean().optional().default(false), resumeRunId: z.string().regex(/^[a-f0-9-]{8,64}$/i).optional(),
      maxRetries: z.number().int().min(0).max(2).optional().default(1), timeoutMs: z.number().int().min(1000).max(1800000).optional().default(900000),
      assertionTimeoutMs: z.number().int().min(100).max(30000).optional().default(3000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; platform?: TestPlatform; suites?: Suite[]; module?: string; variant?: string; targetId?: string; includeSavedUiTests?: boolean; testCaseIds?: string[]; execute?: boolean; resumeRunId?: string; maxRetries?: number; timeoutMs?: number; assertionTimeoutMs?: number }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd())); const config = getConfigDir(root); const reportRoot = path.join(config, 'test-reports');
    const gitHead = await gitValue(root, ['rev-parse', 'HEAD']); const porcelain = await gitValue(root, ['status', '--porcelain']); const clean = porcelain === null ? null : porcelain.length === 0;
    const detected = args.platform ?? detectTestPlatform(root); if (!detected) throw new Error('No supported Flutter pubspec.yaml or Gradle settings file found at the selected project root.');
    const warnings: string[] = []; if (!gitHead) warnings.push('Git HEAD provenance unavailable; evidence gate cannot pass.'); if (clean !== true) warnings.push('Working tree is dirty or unverifiable; evidence gate cannot pass.');
    let manifest: Manifest; let reportDir: string; let platform: TestPlatform = detected;
    if (args.resumeRunId) {
      const file = path.join(reportRoot, '.runs', args.resumeRunId + '.json'); const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Manifest;
      if (path.resolve(raw.projectRoot) !== path.resolve(root)) throw new Error('Cannot resume a run from a different project root.');
      if (raw.gitHeadSha !== gitHead) throw new Error('Cannot resume: Git HEAD changed since this run began.');
      platform = raw.platform; reportDir = path.resolve(root, raw.reportDirectory);
      if (!reportDir.startsWith(root + path.sep)) throw new Error('Stored report path resolves outside the project root.');
      manifest = raw; manifest.module = args.module ?? manifest.module; manifest.variant = args.variant ?? manifest.variant ?? 'debug';
      for (const item of manifest.work) if (item.status === 'running' && item.kind === 'ui-case') { item.status = 'incomplete'; item.error = 'Interrupted UI case was not replayed because the last action may have side effects. Inspect the device and start a new run for that case.'; }
      manifest.work = manifest.work.map((item) => item.status === 'running' && item.kind === 'suite' ? { ...item, status: 'pending' } : item);
      manifest.warnings = [...manifest.warnings, ...warnings, 'Resumed run; passed work items were preserved.'];
    } else {
      platform = detected; const cases = args.includeSavedUiTests === false ? [] : await loadCases(path.join(config, 'testcases'));
      const chosen = args.testCaseIds?.length ? cases.filter((c) => args.testCaseIds!.includes(String(c.id))) : cases.slice(0, 30);
      const work: UnifiedWorkResult[] = [];
      for (const suite of [...new Set<Suite>(args.suites ?? ['unit'])]) {
        const available = await suiteAvailable(root, platform, suite, args.module);
        work.push({ id: 'suite:' + suite, kind: 'suite', name: suite, status: available ? 'pending' : 'unavailable', attempts: 0, durationMs: 0, evidence: [], ...(!available ? { error: 'Requested suite source directory was not found.' } : {}) });
      }
      for (const c of chosen) { const id = String(c.id); work.push({ id: 'ui:' + id, kind: 'ui-case', name: String(c.title ?? c.name ?? id), status: Array.isArray(c.steps) && c.steps.length ? 'pending' : 'incomplete', attempts: 0, durationMs: 0, evidence: [], completedSteps: 0, ...(!(Array.isArray(c.steps) && c.steps.length) ? { error: 'Saved test case has no executable steps.' } : {}) }); }
      if (args.testCaseIds?.length) { const found = new Set(chosen.map((c) => String(c.id))); for (const id of args.testCaseIds.filter((x) => !found.has(x))) work.push({ id: 'ui:' + id, kind: 'ui-case', name: id, status: 'unavailable', attempts: 0, durationMs: 0, evidence: [], error: 'Requested saved test case ID was not found.' }); }
      if (args.includeSavedUiTests !== false && cases.length === 0) { warnings.push('No saved UI test cases were found.'); work.push({ id: 'ui-cases:none', kind: 'ui-case', name: 'Saved UI test cases', status: 'unavailable', attempts: 0, durationMs: 0, evidence: [], error: 'No saved UI test cases were found.' }); }
      const now = new Date(); const date = now.toISOString().slice(0, 10); const time = now.toISOString().slice(11, 19).replace(/:/g, ''); const runId = randomUUID();
      reportDir = path.join(reportRoot, date, time + '-unified-' + runId.slice(0, 8)); await fs.mkdir(reportDir, { recursive: true });
      manifest = { schemaVersion: 1, runId, projectRoot: root, gitHeadSha: gitHead, workingTreeClean: clean, startedAt: now.toISOString(), updatedAt: now.toISOString(), reportDirectory: rel(root, reportDir), targetId: args.targetId, platform, module: args.module, variant: args.variant ?? 'debug', requestedSuites: [...new Set<Suite>(args.suites ?? ['unit'])], includeSavedUiTests: args.includeSavedUiTests !== false, work, warnings };
      await saveManifest(config, manifest);
    }
    if (!args.execute) { const preview = { mode: 'plan-only', runId: manifest.runId, projectRoot: root, platform: manifest.platform, reportDirectory: manifest.reportDirectory, work: manifest.work, warnings: manifest.warnings, executionRequires: 'Review the plan, then set execute=true. Resume with resumeRunId.' }; return textResult(JSON.stringify(preview, null, 2), preview as unknown as Record<string, unknown>); }
    const runLock = await acquireProjectRunLock(root, manifest.runId);
    try {
    await fs.mkdir(reportDir, { recursive: true });
    let target: Awaited<ReturnType<typeof resolveTarget>> | undefined; let backend: Awaited<ReturnType<typeof resolveTargetAndBackend>>['backend'] | undefined;
    const pending = selectResumableWork(manifest.work);
    if (pending.some((x) => x.kind === 'ui-case')) {
      try { const resolved = await resolveTargetAndBackend(args.targetId ?? manifest.targetId); target = resolved.target; backend = resolved.backend; manifest.targetId = target.id; }
      catch (e) { const msg = redact(e instanceof Error ? e.message : String(e)); for (const item of pending.filter((x) => x.kind === 'ui-case' && x.status !== 'unavailable')) { item.status = 'blocked'; item.error = msg; } manifest.warnings.push('Saved UI cases blocked because no target was available: ' + msg); }
    }
    for (const item of pending) {
      if (item.status === 'unavailable' || item.status === 'failed' || item.status === 'incomplete') continue;
      if (item.kind === 'suite') {
        const suite = item.name as Suite; let device: Awaited<ReturnType<typeof resolveTarget>> | undefined;
        if (suite === 'integration') try { device = await resolveTarget({ requestedId: args.targetId ?? manifest.targetId }); } catch (e) { item.status = 'blocked'; item.error = redact(e instanceof Error ? e.message : String(e)); await saveManifest(config, manifest); continue; }
        item.status = 'running'; await saveManifest(config, manifest);
        const module = args.module ?? manifest.module; const variant = args.variant ?? manifest.variant ?? 'debug'; const m = (module ?? '').trim().replace(/^:+|:+$/g, ''); const prefix = m ? ':' + m + ':' : ''; const cap = variant[0]!.toUpperCase() + variant.slice(1);
        const command = platform === 'flutter' ? ((suite === 'unit' ? (process.env.FLUTTER_PATH || 'flutter') + ' test' : (process.env.FLUTTER_PATH || 'flutter') + ' test -d ' + (device?.id ?? '') + ' integration_test')) : ('Gradle ' + prefix + (suite === 'unit' ? 'test' + cap + 'UnitTest' : 'connected' + cap + 'AndroidTest'));
        let finalError = '';
        for (let attempt = 0; attempt <= (args.maxRetries ?? 1); attempt++) {
          item.attempts++; const start = Date.now();
          try {
            let result: { exitCode: number; stdout: string; stderr: string };
            if (platform === 'flutter') result = await execCommand(process.env.FLUTTER_PATH || 'flutter', suite === 'unit' ? ['test'] : ['test', '-d', device!.id, 'integration_test'], { cwd: root, timeoutMs: args.timeoutMs ?? 900000 });
            else result = await runGradle(root, [prefix + (suite === 'unit' ? 'test' + cap + 'UnitTest' : 'connected' + cap + 'AndroidTest')], { timeoutMs: args.timeoutMs ?? 900000, env: device ? { ANDROID_SERIAL: device.id } : undefined });
            item.durationMs += Date.now() - start; item.command = command; item.exitCode = result.exitCode; item.stdout = redact(result.stdout).slice(-20000); item.stderr = redact(result.stderr).slice(-20000);
            if (result.exitCode === 0) { item.status = 'passed'; finalError = ''; break; }
            finalError = result.stderr || result.stdout || ('Exit code ' + result.exitCode); item.status = 'failed';
            if (attempt >= (args.maxRetries ?? 1) || !isRetryableTransient(finalError)) break;
          } catch (e) {
            item.durationMs += Date.now() - start; finalError = redact(e instanceof Error ? e.message : String(e)); item.error = finalError;
            item.status = /not found|not installed|no such file|sdk location|no devices|device.*not found|multiple targets|offline|unauthorized/i.test(finalError) ? 'blocked' : 'failed';
            if (item.status !== 'failed' || attempt >= (args.maxRetries ?? 1) || !isRetryableTransient(finalError)) break;
          }
          await saveManifest(config, manifest); await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
        if (finalError) item.error = finalError;
        if (item.status === 'failed' && !item.evidence.length) { const f = path.join(reportDir, 'evidence', slug(item.id) + '-output.txt'); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, 'COMMAND: ' + command + '\nSTDOUT:\n' + (item.stdout ?? '') + '\nSTDERR:\n' + (item.stderr ?? '') + '\n', 'utf8'); item.evidence.push(rel(root, f)); }
      } else if (item.kind === 'ui-case') {
        if (!target || !backend) { item.status = 'blocked'; item.error = 'No ready Android target/backend is available.'; }
        else { const cases = await loadCases(path.join(config, 'testcases')); const c = cases.find((x) => String(x.id) === item.id.slice(3)); if (!c) { item.status = 'unavailable'; item.error = 'Saved test case no longer exists.'; } else { item.status = 'running'; item.attempts++; await saveManifest(config, manifest); await runCase(root, reportDir, target.id, backend, c, item, args.assertionTimeoutMs ?? 3000); } }
      }
      await saveManifest(config, manifest);
    }
    manifest.work = manifest.work.map((x) => x.status === 'running' ? { ...x, status: 'incomplete', error: 'Run ended before this item recorded a final outcome.' } : x);
    const finalHead = await gitValue(root, ['rev-parse', 'HEAD']);
    const finalPorcelain = await gitValue(root, ['status', '--porcelain']);
    if (finalHead !== manifest.gitHeadSha) { manifest.warnings.push('Git HEAD changed during the run; commit-bound evidence is invalid.'); manifest.gitHeadSha = null; }
    if (finalPorcelain !== '') { manifest.warnings.push('Working tree is dirty or unverifiable after execution.'); manifest.workingTreeClean = false; }
    const gate = evaluateUnifiedGate({ work: manifest.work, gitHeadSha: manifest.gitHeadSha, workingTreeClean: manifest.workingTreeClean });
    const failureDiagnostics = manifest.work.filter((item) => item.status === 'failed' || item.status === 'blocked' || item.status === 'incomplete').map((item) => ({ id: item.id, status: item.status, ...classifyRuntimeError(item.error ?? item.stderr ?? item.name, { phase: item.kind === 'suite' ? 'test' : undefined }) }));
    const summary = { schemaVersion: 1, workflow: 'unified-test-run', mode: 'execute', runId: manifest.runId, status: gate.decision, gate, projectRoot: root, platform: manifest.platform, gitHeadSha: manifest.gitHeadSha, workingTreeClean: manifest.workingTreeClean, startedAt: manifest.startedAt, completedAt: new Date().toISOString(), target: target ? { id: target.id, model: target.model } : (manifest.targetId ? { id: manifest.targetId } : null), work: manifest.work, failureDiagnostics, warnings: manifest.warnings, reportDirectory: manifest.reportDirectory };
    await fs.writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8', flag: 'w' });
    await fs.writeFile(path.join(reportDir, 'summary.md'), ['# Unified TestOrbit Test Run', '', '- **Decision:** ' + gate.decision.toUpperCase(), '- **Reason:** ' + gate.reason, '- **Run ID:** ' + manifest.runId, '- **Platform:** ' + platform, '- **Git HEAD:** ' + (manifest.gitHeadSha ?? 'UNAVAILABLE'), '- **Working tree clean:** ' + String(manifest.workingTreeClean), '- **Passed:** ' + gate.passed, '- **Failed:** ' + gate.failed, '- **Incomplete:** ' + gate.incomplete, '', '## Work items', ...manifest.work.map((x) => '- **' + x.status.toUpperCase() + '** ' + x.id + ' — ' + x.name + (x.error ? ' — ' + x.error : '') + (x.evidence.length ? ' — Evidence: ' + x.evidence.join(', ') : '')), '', '## Warnings', ...(manifest.warnings.length ? manifest.warnings.map((x) => '- ' + x) : ['- None']), ''].join('\n'), { encoding: 'utf8', flag: 'w' });
    await saveManifest(config, manifest);
    const output = { ...summary, summaryJson: rel(root, path.join(reportDir, 'summary.json')), summaryMarkdown: rel(root, path.join(reportDir, 'summary.md')), resumableManifest: rel(root, path.join(reportRoot, '.runs', manifest.runId + '.json')) };
    return textResult(JSON.stringify(output, null, 2), output as unknown as Record<string, unknown>);
    } finally {
      await runLock.release();
    }
  }));
}
const mod: ToolModule = { toolName, workflow, register };
export default mod;
