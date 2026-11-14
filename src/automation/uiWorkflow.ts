import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execCommand } from '../utils/exec.js';
import { loadConfig } from '../config/loader.js';
import { runAdbShell } from '../utils/adb.js';

type Selector = { resourceId?: string; text?: string; contentDesc?: string; className?: string };
type ScreenElement = { id: string; name?: string; type?: string; selector?: Selector; coordinates?: { x: number; y: number }; normalizedCoordinates?: { x: number; y: number }; required?: boolean; sensitive?: boolean };
type ScreenDefinition = { schemaVersion?: string; id: string; name?: string; form: ScreenElement[]; detection?: { requiredElements?: string[] }; screenshot?: { width: number; height: number } };
type WorkflowAction = { id: string; type: 'tap'|'type'|'wait'|'wait_for_screen'|'assert_screen'|'back'|'key'; screen?: string; element?: string; value?: string; timeoutMs?: number; intervalMs?: number; key?: string };
type WorkflowDefinition = { schemaVersion?: string; id: string; name?: string; forms: Record<string,string>; actions: WorkflowAction[]; settings?: { stopOnFailure?: boolean; verifyAfterAction?: boolean } };
export type StepResult = { id: string; type: string; status: 'passed'|'failed'; durationMs: number; message?: string };
export type WorkflowResult = { workflowId: string; success: boolean; startedAt: string; durationMs: number; steps: StepResult[]; reportPath: string; sequenceCachePath?: string };

const ROOT = '.testorbit';
const MAX_JSON_BYTES = 1024 * 1024;
const ACTION_TYPES = new Set(['tap','type','wait','wait_for_screen','assert_screen','back','key']);

function safeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) || value === '.' || value === '..') throw new Error(`Invalid ${label}: ${value}`);
  return value;
}
function within(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error('Absolute paths are not allowed in workflow definitions.');
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Workflow path escapes the project test directory.');
  return resolved;
}
async function readJson<T>(file: string): Promise<T> {
  const data = await readFile(file);
  if (data.byteLength > MAX_JSON_BYTES) throw new Error(`JSON definition exceeds ${MAX_JSON_BYTES} bytes: ${file}`);
  return JSON.parse(data.toString('utf8')) as T;
}
function validateWorkflow(value: WorkflowDefinition): void {
  if (!value || typeof value.id !== 'string' || !Array.isArray(value.actions) || !value.forms || typeof value.forms !== 'object') throw new Error('Invalid workflow JSON: expected id, forms object, and actions array.');
  safeId(value.id, 'workflow id');
  if (value.actions.length < 1 || value.actions.length > 300) throw new Error('Workflow must contain between 1 and 300 actions.');
  const ids = new Set<string>();
  for (const action of value.actions) {
    if (!action || typeof action.id !== 'string' || !ACTION_TYPES.has(action.type)) throw new Error('Each action requires a unique id and supported type.');
    safeId(action.id, 'action id');
    if (ids.has(action.id)) throw new Error(`Duplicate action id: ${action.id}`);
    ids.add(action.id);
    if (['tap','type'].includes(action.type) && (!action.screen || !action.element)) throw new Error(`Action ${action.id} requires screen and element.`);
    if (['wait_for_screen','assert_screen'].includes(action.type) && !action.screen) throw new Error(`Action ${action.id} requires screen.`);
  }
}
function selectorExpression(selector: Selector): string | undefined {
  const parts: string[] = [];
  if (selector.resourceId) parts.push(`id=${selector.resourceId}`);
  if (selector.text) parts.push(`text=${selector.text}`);
  if (selector.contentDesc) parts.push(`desc=${selector.contentDesc}`);
  if (selector.className) parts.push(`class=${selector.className}`);
  return parts.length ? parts.join(',') : undefined;
}
function resolveValue(value: string): string {
  return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => {
    const resolved = process.env[key];
    if (resolved === undefined) throw new Error(`Environment variable ${key} is not set.`);
    return resolved;
  });
}
function findElement(screen: ScreenDefinition, id: string): ScreenElement {
  const found = screen.form.find((item) => item.id === id);
  if (!found) throw new Error(`Element "${id}" is not defined in screen "${screen.id}".`);
  return found;
}
async function android(args: string[], cwd: string, timeoutMs = 30000): Promise<string> {
  const configuredPath = loadConfig({ cwd }).paths.androidCliPath;
  const command = process.env.ANDROID_CLI_PATH || configuredPath || 'android';
  const result = await execCommand(command, args, { cwd, timeoutMs });
  if (result.exitCode !== 0) throw new Error(`Google Android CLI failed (${result.exitCode}): ${result.stderr || result.stdout}`);
  return result.stdout;
}
function flattenLayout(value: unknown): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = node as Record<string, unknown>;
    if (['text','resourceId','resource-id','contentDescription','content-desc','bounds','className','class'].some((key) => key in record)) result.push(record);
    for (const child of Object.values(record)) if (child && typeof child === 'object') visit(child);
  };
  visit(value);
  return result;
}
function hasElement(layout: Array<Record<string, unknown>>, element: ScreenElement): boolean {
  const selector = element.selector;
  if (!selector) return false;
  return layout.some((node) => {
    const value = (key: string, alt?: string) => String(node[key] ?? (alt ? node[alt] : '') ?? '').toLowerCase();
    return (!selector.resourceId || value('resourceId','resource-id').includes(selector.resourceId.toLowerCase()))
      && (!selector.text || value('text').includes(selector.text.toLowerCase()))
      && (!selector.contentDesc || value('contentDescription','content-desc').includes(selector.contentDesc.toLowerCase()))
      && (!selector.className || value('className','class').includes(selector.className.toLowerCase()));
  });
}
async function currentLayout(cwd: string, deviceId?: string, timeoutMs = 30000): Promise<Array<Record<string, unknown>>> {
  const args = ['layout','--pretty'];
  if (deviceId) args.push(`--device=${deviceId}`);
  return flattenLayout(JSON.parse(await android(args, cwd, timeoutMs)));
}
async function waitForScreen(screen: ScreenDefinition, cwd: string, deviceId: string|undefined, timeoutMs: number, intervalMs: number): Promise<void> {
  const requiredIds = screen.detection?.requiredElements ?? screen.form.filter((item) => item.required).map((item) => item.id);
  if (!requiredIds.length) throw new Error(`Screen "${screen.id}" has no required elements to verify.`);
  const deadline = Date.now() + timeoutMs;
  let lastMissing = requiredIds;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const layout = await currentLayout(cwd, deviceId, remainingMs);
    lastMissing = requiredIds.filter((id) => !hasElement(layout, findElement(screen, id)));
    if (!lastMissing.length) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
  }
  throw new Error(`Timed out waiting for screen "${screen.id}". Missing elements: ${lastMissing.join(', ')}`);
}

export async function runUiWorkflow(options: { cwd: string; workflowFile: string; deviceId?: string }): Promise<WorkflowResult> {
  const projectRoot = path.resolve(options.cwd);
  const root = path.resolve(projectRoot, ROOT);
  const sequenceDir = path.join(root, 'action-sequences');
  const isSequence = options.workflowFile.replace(/\\\\/g, '/').startsWith('action-sequences/');
  const workflowDir = isSequence ? sequenceDir : path.join(root, 'workflows');
  const relativeWorkflowPath = isSequence ? options.workflowFile.slice('action-sequences/'.length) : options.workflowFile;
  const workflowPath = within(workflowDir, relativeWorkflowPath);
  if (!workflowPath.endsWith('.json')) throw new Error('Workflow file must end in .json.');
  const workflow = await readJson<WorkflowDefinition>(workflowPath);
  validateWorkflow(workflow);
  const screens = new Map<string, ScreenDefinition>();
  for (const [key, relative] of Object.entries(workflow.forms)) {
    safeId(key, 'screen key');
    const file = within(path.join(root, 'screens'), relative);
    if (!file.endsWith('.json')) throw new Error(`Screen definition for ${key} must be JSON.`);
    const screen = await readJson<ScreenDefinition>(file);
    safeId(screen.id, 'screen id');
    if (!Array.isArray(screen.form)) throw new Error(`Screen ${key} requires a form array.`);
    screens.set(key, screen);
  }
  const startedAt = new Date();
  const started = Date.now();
  const steps: StepResult[] = [];
  for (const action of workflow.actions) {
    const stepStart = Date.now();
    try {
      const screen = action.screen ? screens.get(action.screen) : undefined;
      if (action.screen && !screen) throw new Error(`Unknown screen key: ${action.screen}`);
      switch (action.type) {
        case 'tap':
        case 'type': {
          const element = findElement(screen!, action.element!);
          const selector = element.selector ? selectorExpression(element.selector) : undefined;
          if (selector) {
            const args = ['input'];
            if (options.deviceId) args.push(`--device=${options.deviceId}`);
            args.push(action.type === 'type' ? 'text' : 'tap');
            if (action.type === 'type') args.push(resolveValue(action.value ?? ''));
            args.push(selector);
            await android(args, projectRoot);
          } else if (element.coordinates || element.normalizedCoordinates) {
            if (action.type !== 'tap') throw new Error('Coordinate fallback supports tap only; add a semantic selector for text input.');
            let x: number;
            let y: number;
            if (element.normalizedCoordinates) {
              if (!options.deviceId) throw new Error('Normalized coordinate fallback requires a resolved device ID.');
              const display = await runAdbShell(options.deviceId, ['wm', 'size']);
              const sizeMatch = display.stdout.match(/Override size: *([0-9]+)x([0-9]+)/) ?? display.stdout.match(/Physical size: *([0-9]+)x([0-9]+)/);
              if (!sizeMatch) throw new Error('Unable to resolve device display dimensions for normalized coordinates.');
              x = element.normalizedCoordinates.x * Number(sizeMatch[1]);
              y = element.normalizedCoordinates.y * Number(sizeMatch[2]);
            } else {
              x = element.coordinates!.x;
              y = element.coordinates!.y;
            }
            const args = [...(options.deviceId ? ['-s', options.deviceId] : []), 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))];
            const adb = process.env.ADB_PATH || 'adb';
            const { execCommand } = await import('../utils/exec.js');
            const result = await execCommand(adb, args, { cwd: projectRoot, timeoutMs: 15000 });
            if (result.exitCode !== 0) throw new Error(result.stderr || 'ADB coordinate tap failed.');
          } else throw new Error(`Element ${element.id} needs a semantic selector or coordinates.`);
          if (workflow.settings?.verifyAfterAction) await currentLayout(projectRoot, options.deviceId);
          break;
        }
        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(action.timeoutMs ?? 500, 0), 120000)));
          break;
        case 'wait_for_screen':
        case 'assert_screen':
          await waitForScreen(screen!, projectRoot, options.deviceId, action.timeoutMs ?? 10000, action.intervalMs ?? 500);
          break;
        case 'back':
          await android(['input', ...(options.deviceId ? [`--device=${options.deviceId}`] : []), 'key', action.key ?? 'back'], projectRoot);
          break;
        case 'key':
          if (!action.key) throw new Error('key action requires key.');
          await android(['input', ...(options.deviceId ? [`--device=${options.deviceId}`] : []), 'key', action.key], projectRoot);
          break;
      }
      steps.push({ id: action.id, type: action.type, status: 'passed', durationMs: Date.now() - stepStart });
    } catch (error) {
      steps.push({ id: action.id, type: action.type, status: 'failed', durationMs: Date.now() - stepStart, message: error instanceof Error ? error.message : String(error) });
      if (workflow.settings?.stopOnFailure !== false) break;
    }
  }
  const success = steps.length === workflow.actions.length && steps.every((step) => step.status === 'passed');
  const date = startedAt.toISOString().slice(0,10);
  const time = startedAt.toISOString().slice(11,19).replace(/:/g,'');
  const reportDir = path.join(root, 'test-reports', date, `${time}-${randomUUID().slice(0,8)}`);
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'workflow-report.json');
  const durationMs = Date.now() - started;
  const result: WorkflowResult = { workflowId: workflow.id, success, startedAt: startedAt.toISOString(), durationMs, steps, reportPath: path.relative(projectRoot, reportPath) };
  await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  if (success) {
    await mkdir(sequenceDir, { recursive: true });
    const sequenceCachePath = path.join(sequenceDir, `${workflow.id}.json`);
    const sequence = {
      ...workflow,
      _cache: {
        sourceWorkflow: path.relative(root, workflowPath).split(path.sep).join('/'),
        lastSuccessfulRun: startedAt.toISOString(),
        lastDurationMs: durationMs,
        lastSuccessfulSteps: steps.map(({ id, type, durationMs: stepDurationMs }) => ({ id, type, durationMs: stepDurationMs })),
        replayInstructions: 'Replay with run_ui_workflow using workflowFile action-sequences/<workflow-id>.json. Validate selectors and screen state before coordinate fallback.',
      },
    };
    await writeFile(sequenceCachePath, JSON.stringify(sequence, null, 2) + '\n', 'utf8');
    result.sequenceCachePath = path.relative(projectRoot, sequenceCachePath);
  }
  return result;
}
