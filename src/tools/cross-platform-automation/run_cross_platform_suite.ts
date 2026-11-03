import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AutomationEngine } from '../../platform/engine.js';
import { FileRunCheckpointStore } from '../../platform/checkpoint.js';
import { createPlatformDrivers } from '../../platform/drivers.js';
import { parseAutomationTest } from '../../platform/specification.js';
import { evaluateCrossPlatformSuiteGate } from '../../platform/suite.js';
import { toJunitXml } from '../../platform/reporting/junit.js';
import { redactSensitiveText } from '../../platform/reporting/redaction.js';
import { execCommand } from '../../utils/exec.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'run_cross_platform_suite';
export const workflow = 'cross-platform-automation';

async function gitState(root: string): Promise<{ gitHeadSha: string | null; workingTreeClean: boolean | null }> {
  try {
    const [head, status] = await Promise.all([
      execCommand('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 5000 }),
      execCommand('git', ['status', '--porcelain'], { cwd: root, timeoutMs: 5000 })
    ]);
    return {
      gitHeadSha: head.exitCode === 0 && /^[a-f0-9]{40,64}$/i.test(head.stdout.trim()) ? head.stdout.trim() : null,
      workingTreeClean: status.exitCode === 0 ? status.stdout.trim().length === 0 : null
    };
  } catch {
    return { gitHeadSha: null, workingTreeClean: null };
  }
}

async function loadDefinitions(directory: string) {
  let names: string[];
  try {
    names = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const definitions: Array<{ file: string; definition: ReturnType<typeof parseAutomationTest>; sha256: string }> = [];
  const ids = new Set<string>();
  for (const name of names) {
    const raw = await fs.readFile(path.join(directory, name));
    const definition = parseAutomationTest(JSON.parse(raw.toString('utf8')));
    if (ids.has(definition.id)) throw new Error('Duplicate cross-platform test ID "' + definition.id + '" in saved suite.');
    ids.add(definition.id);
    definitions.push({ file: name, definition, sha256: createHash('sha256').update(raw).digest('hex') });
  }
  return definitions;
}

function definitionManifest(items: Array<{ file: string; sha256: string }>): string {
  return createHash('sha256').update(items.map((item) => item.file + ':' + item.sha256).sort().join('\\n')).digest('hex');
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Run Saved Cross-Platform Test Suite',
    description: 'Validate and optionally execute every saved cross-platform test definition in .androidmcp-framework/cross-platform-tests. Validates the complete suite before device actions, executes definitions sequentially with bounded per-test platform concurrency, persists checkpoints and one provenance-aware suite report.',
    inputSchema: {
      projectPath: z.string().optional(),
      suitePath: z.string().optional(),
      execute: z.boolean().optional().default(false),
      maxConcurrency: z.number().int().min(1).max(4).optional().default(2),
      runTimeoutMs: z.number().int().min(1000).max(3600000).optional(),
      testIds: z.array(z.string().min(1).max(100)).max(100).optional(),
      stopOnFailure: z.boolean().optional().default(false)
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, withErrorHandling(async (args: { projectPath?: string; suitePath?: string; execute?: boolean; maxConcurrency?: number; runTimeoutMs?: number; testIds?: string[]; stopOnFailure?: boolean }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const suiteDirectory = path.resolve(root, args.suitePath ?? '.androidmcp-framework/cross-platform-tests');
    const relative = path.relative(root, suiteDirectory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('suitePath must remain inside the selected project root.');
    const definitions = await loadDefinitions(suiteDirectory);
    const selected = args.testIds?.length ? definitions.filter((item) => args.testIds!.includes(item.definition.id)) : definitions;
    const missing = (args.testIds ?? []).filter((id) => !definitions.some((item) => item.definition.id === id));
    if (missing.length) throw new Error('Requested cross-platform test IDs were not found: ' + missing.join(', '));
    const state = await gitState(root);
    const definitionManifestSha256 = definitionManifest(selected);
    const runId = randomUUID();
    const now = new Date();
    const reportDirectory = path.join(root, '.androidmcp-framework', 'test-reports', now.toISOString().slice(0, 10), now.toISOString().slice(11, 19).replace(/:/g, '-') + '-cross-platform-suite-' + runId.slice(0, 8));
    const plan = selected.map(({ file, definition }) => ({ file, id: definition.id, name: definition.name, platforms: definition.platforms, steps: definition.steps.length, targets: definition.targets ?? {} }));
    if (!args.execute) {
      const preview = { mode: 'plan-only', runId, projectRoot: root, suiteDirectory: relative, definitionCount: selected.length, plan, definitionManifestSha256, definitionFiles: selected.map(({ file, sha256 }) => ({ file, sha256 })), gitHeadSha: state.gitHeadSha, workingTreeClean: state.workingTreeClean, executionRequires: 'Review every test definition and target, then set execute=true.' };
      return textResult(JSON.stringify(preview, null, 2), preview);
    }
    if (!selected.length) throw new Error('No saved cross-platform test definitions were selected; an empty suite cannot pass.');
    await fs.mkdir(reportDirectory, { recursive: true });
    const outcomes: Array<{ id: string; file: string; name: string; success: boolean; cancelled: boolean; timedOut: boolean; durationMs: number; summary: unknown; platforms: unknown[]; error?: string }> = [];
    const junitSuites: string[] = [];
    for (const item of selected) {
      const checkpointPath = path.join(root, '.androidmcp-framework', 'test-reports', '.runs', 'cross-platform', runId + '-' + item.definition.id + '.json');
      try {
        const result = await new AutomationEngine({ drivers: createPlatformDrivers(), maxConcurrency: args.maxConcurrency }).run(item.definition, {
          maxConcurrency: args.maxConcurrency,
          timeoutMs: args.runTimeoutMs,
          checkpointStore: new FileRunCheckpointStore(checkpointPath)
        });
        junitSuites.push(toJunitXml(result).replace(/^<\?xml[^>]*>\s*/, ''));
        const platformResults = [];
        for (const p of result.platforms) {
          let screenshotPath: string | undefined;
          let snapshotPath: string | undefined;
          if (p.evidence?.screenshot) {
            screenshotPath = path.join(reportDirectory, 'evidence-' + item.definition.id + '-' + p.platform + '.png');
            await fs.writeFile(screenshotPath, Buffer.from(p.evidence.screenshot.base64, 'base64'));
          }
          if (p.evidence?.snapshot) {
            snapshotPath = path.join(reportDirectory, 'snapshot-' + item.definition.id + '-' + p.platform + '.json');
            await fs.writeFile(snapshotPath, JSON.stringify(p.evidence.snapshot, null, 2), 'utf8');
          }
          platformResults.push({
            platform: p.platform, status: p.status ?? (p.success ? 'passed' : 'failed'),
            success: p.success, durationMs: p.durationMs, steps: p.steps, error: p.error,
            evidence: p.evidence ? {
              capturedAt: p.evidence.capturedAt,
              ...(screenshotPath ? { screenshotPath: path.relative(root, screenshotPath).split(path.sep).join('/') } : {}),
              ...(snapshotPath ? { snapshotPath: path.relative(root, snapshotPath).split(path.sep).join('/') } : {})
            } : undefined
          });
        }
        outcomes.push({
          id: item.definition.id, file: item.file, name: item.definition.name,
          success: result.success, cancelled: result.cancelled, timedOut: result.timedOut,
          durationMs: result.durationMs, summary: result.summary, platforms: platformResults
        });
        if (!result.success && args.stopOnFailure) break;
      } catch (error) {
        outcomes.push({ id: item.definition.id, file: item.file, name: item.definition.name, success: false, cancelled: false, timedOut: false, durationMs: 0, summary: null, platforms: [], error: error instanceof Error ? error.message : String(error) });
        if (args.stopOnFailure) break;
      }
    }
    const definitionsUnchanged = (await Promise.all(selected.map(async (item) => {
      try { return createHash('sha256').update(await fs.readFile(path.join(suiteDirectory, item.file))).digest('hex') === item.sha256; }
      catch { return false; }
    }))).every(Boolean);
    const gate = evaluateCrossPlatformSuiteGate({ outcomes, gitHeadSha: state.gitHeadSha, workingTreeClean: state.workingTreeClean, selectedCount: selected.length, definitionManifestSha256, definitionsUnchanged });
    const secrets = selected.flatMap(({ definition }) => Object.values(definition.variables ?? {}).filter((value): value is string => typeof value === 'string'));
    const report = { schemaVersion: 1, runId, generatedAt: new Date().toISOString(), projectRoot: root, suiteDirectory: relative, gitHeadSha: state.gitHeadSha, workingTreeClean: state.workingTreeClean, definitionManifestSha256, definitionsUnchanged, definitionFiles: selected.map(({ file, sha256 }) => ({ file, sha256 })), gate, selectedCount: selected.length, executedCount: outcomes.length, outcomes };
    const jsonPath = path.join(reportDirectory, 'cross-platform-suite.json');
    const markdownPath = path.join(reportDirectory, 'cross-platform-suite.md');
    const junitPath = path.join(reportDirectory, 'junit.xml');
    const lines = ['# Cross-platform suite report', '', '- Run: ' + runId, '- Decision: ' + gate.decision, '- Git HEAD: ' + (state.gitHeadSha ?? 'unavailable'), '- Working tree clean: ' + String(state.workingTreeClean), '- Definition manifest SHA-256: ' + definitionManifestSha256, '- Definitions unchanged: ' + String(definitionsUnchanged), '- Definitions: ' + gate.passed + ' passed; ' + gate.failed + ' failed; ' + gate.incomplete + ' incomplete', '- Executed: ' + outcomes.length + ' / ' + selected.length, '', '## Test results', ''];
    for (const outcome of outcomes) lines.push('### ' + outcome.id + ' — ' + (outcome.success ? 'PASSED' : 'FAILED'), '', '- Definition: ' + outcome.file, '- Duration: ' + outcome.durationMs + ' ms', ...(outcome.error ? ['- Error: ' + outcome.error] : []), '');
    lines.push('## Gate rationale', '', gate.reason, '');
    await Promise.all([
      fs.writeFile(jsonPath, redactSensitiveText(JSON.stringify(report, null, 2), secrets), 'utf8'),
      fs.writeFile(markdownPath, redactSensitiveText(lines.join('\n'), secrets), 'utf8'),
      fs.writeFile(junitPath, redactSensitiveText('<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n' + junitSuites.join('\n') + '\n</testsuites>\n', secrets), 'utf8')
    ]);
    const response = { runId, gate, selectedCount: selected.length, executedCount: outcomes.length, reportDirectory, jsonReport: jsonPath, markdownReport: markdownPath, junitReport: junitPath, outcomes: outcomes.map(({ id, name, success, durationMs, error }) => ({ id, name, success, durationMs, error })) };
    return textResult(JSON.stringify(response, null, 2), response);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
