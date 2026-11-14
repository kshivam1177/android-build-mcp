import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfigDir } from '../../config/loader.js';
import { listTargets } from '../../utils/adb.js';
import { getEffectiveSessionDefaults } from '../../session/defaults.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'validate_test_environment';
export const workflow = 'testing-intelligence';

const SUPPORTED_ACTIONS = new Set(['tap', 'type_text', 'key_press', 'button', 'wait_for_ui']);

export interface EnvironmentCheck {
  name: string;
  status: 'pass' | 'warning' | 'blocker';
  detail: string;
}

export function classifyTestCase(value: unknown): { valid: boolean; stepCount: number; unsupportedActions: string[]; issues: string[] } {
  const issues: string[] = [];
  const unsupportedActions: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, stepCount: 0, unsupportedActions, issues: ['Test case JSON must be an object.'] };
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim()) issues.push('Missing non-empty id.');
  if (typeof item.title !== 'string' || !item.title.trim()) issues.push('Missing non-empty title.');
  if (!Array.isArray(item.steps) || item.steps.length === 0) issues.push('No saved steps.');
  const steps = Array.isArray(item.steps) ? item.steps : [];
  steps.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push('Step ' + (index + 1) + ' must be an object.');
      return;
    }
    const step = raw as Record<string, unknown>;
    const action = typeof step.action === 'string' ? step.action.toLowerCase() : 'tap';
    if (!SUPPORTED_ACTIONS.has(action)) unsupportedActions.push('Step ' + (index + 1) + ': ' + action);
    if ((action === 'tap' || action === 'type_text') && !(typeof step.target === 'string' && step.target.trim()) && !(typeof step.description === 'string' && step.description.trim())) {
      issues.push('Step ' + (index + 1) + ' needs a target or description.');
    }
    if (action === 'type_text' && !(typeof step.text === 'string' && step.text.length > 0) && !(typeof step.value === 'string' && step.value.length > 0) && !(typeof step.description === 'string' && step.description.includes("'"))) {
      issues.push('Step ' + (index + 1) + ' has no text/value to type.');
    }
  });
  return { valid: issues.length === 0 && unsupportedActions.length === 0, stepCount: steps.length, unsupportedActions, issues };
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Validate Test Environment',
    description: 'Preflight the Android/Flutter workspace, saved test cases, ADB availability, and target readiness before a device test workflow. Read-only: it does not build, install, launch, or interact with the app.',
    inputSchema: {
      projectPath: z.string().optional().describe('Project/workspace root; defaults to the current directory.'),
      targetId: z.string().optional().describe('Target to validate. Defaults to the session target; if omitted, one ready target is selected only when unambiguous.'),
      requireDevice: z.boolean().optional().default(true).describe('When true, no ready target is a blocker; set false for a planning-only preflight.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; targetId?: string; requireDevice?: boolean }) => {
    const root = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const configDir = getConfigDir(root);
    const checks: EnvironmentCheck[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];
    const add = (check: EnvironmentCheck) => {
      checks.push(check);
      if (check.status === 'blocker') blockers.push(check.name + ': ' + check.detail);
      if (check.status === 'warning') warnings.push(check.name + ': ' + check.detail);
    };

    const androidProject = await exists(path.join(root, 'settings.gradle')) || await exists(path.join(root, 'settings.gradle.kts')) ||
      await exists(path.join(root, 'build.gradle')) || await exists(path.join(root, 'build.gradle.kts'));
    const flutterProject = await exists(path.join(root, 'pubspec.yaml'));
    if (androidProject || flutterProject) {
      add({ name: 'project', status: 'pass', detail: (androidProject && flutterProject ? 'Android/Flutter' : flutterProject ? 'Flutter' : 'Native Android') + ' project markers found at ' + root });
    } else {
      add({ name: 'project', status: 'warning', detail: 'No root Gradle or pubspec marker found. For a monorepo, pass the specific app/package path.' });
    }

    const configExists = await exists(path.join(configDir, 'config.yaml'));
    add(configExists
      ? { name: 'framework-config', status: 'pass', detail: 'Framework project config exists.' }
      : { name: 'framework-config', status: 'warning', detail: 'No .testorbit/config.yaml found; run testorbit setup to initialize project-local configuration.' });

    const testCaseDir = path.join(configDir, 'testcases');
    let files: string[] = [];
    try { files = (await fs.readdir(testCaseDir)).filter(name => name.endsWith('.json')).sort(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const caseDetails: Array<{ file: string; id?: string; valid: boolean; stepCount: number; issues: string[]; unsupportedActions: string[] }> = [];
    for (const file of files) {
      try {
        const value: unknown = JSON.parse(await fs.readFile(path.join(testCaseDir, file), 'utf8'));
        const classified = classifyTestCase(value);
        const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
        caseDetails.push({ file, ...(typeof record.id === 'string' ? { id: record.id } : {}), valid: classified.valid, stepCount: classified.stepCount, issues: classified.issues, unsupportedActions: classified.unsupportedActions });
      } catch {
        caseDetails.push({ file, valid: false, stepCount: 0, issues: ['Invalid JSON.'], unsupportedActions: [] });
      }
    }
    const validCases = caseDetails.filter(item => item.valid);
    if (validCases.length) add({ name: 'saved-test-cases', status: 'pass', detail: validCases.length + ' executable saved case(s) found (' + caseDetails.length + ' JSON file(s) scanned).' });
    else add({ name: 'saved-test-cases', status: 'blocker', detail: 'No valid executable saved test cases found under .testorbit/testcases/.' });
    for (const invalid of caseDetails.filter(item => !item.valid)) {
      add({ name: 'test-case:' + invalid.file, status: 'warning', detail: [...invalid.issues, ...invalid.unsupportedActions.map(action => 'Unsupported action ' + action)].join(' ') || 'Case is not executable.' });
    }

    const requestedTarget = args.targetId ?? getEffectiveSessionDefaults().defaults.targetId ?? undefined;
    let targets: Awaited<ReturnType<typeof listTargets>> = [];
    let adbAvailable = true;
    try { targets = await listTargets(); }
    catch (error) {
      adbAvailable = false;
      add({ name: 'adb', status: 'blocker', detail: error instanceof Error ? error.message : String(error) });
    }
    if (adbAvailable) add({ name: 'adb', status: 'pass', detail: 'ADB is available; ' + targets.length + ' target(s) detected.' });
    const ready = targets.filter(target => target.state === 'device');
    const selectedTarget = requestedTarget ? targets.find(target => target.id === requestedTarget && target.state === 'device') : ready.length === 1 ? ready[0] : undefined;
    if (requestedTarget && !selectedTarget) {
      add({ name: 'target', status: args.requireDevice === false ? 'warning' : 'blocker', detail: 'Requested/session target "' + requestedTarget + '" is not connected and ready. Detected: ' + (targets.map(target => target.id + '(' + target.state + ')').join(', ') || 'none') + '.' });
    } else if (!requestedTarget && ready.length === 1 && selectedTarget) {
      add({ name: 'target', status: 'pass', detail: 'Unambiguous ready target: ' + selectedTarget.id + ' (' + (selectedTarget.model ?? selectedTarget.type) + ').' });
    } else if (!requestedTarget && ready.length > 1) {
      add({ name: 'target', status: args.requireDevice === false ? 'warning' : 'blocker', detail: 'Multiple ready targets; pass targetId explicitly: ' + ready.map(target => target.id).join(', ') + '.' });
    } else if (!requestedTarget && ready.length === 0) {
      add({ name: 'target', status: args.requireDevice === false ? 'warning' : 'blocker', detail: 'No ready emulator or physical device found.' });
    }

    const integrationTests = await exists(path.join(root, 'integration_test'));
    const flutterTests = await exists(path.join(root, 'test'));
    const nativeUnitTests = await exists(path.join(root, 'src', 'test')) || await exists(path.join(root, 'app', 'src', 'test'));
    if (flutterProject) {
      add(integrationTests
        ? { name: 'flutter-integration-tests', status: 'pass', detail: 'integration_test/ directory exists.' }
        : { name: 'flutter-integration-tests', status: 'warning', detail: 'No integration_test/ directory; Flutter device E2E tests cannot run until one is added. Unit/widget tests may still be available.' });
      add(flutterTests
        ? { name: 'flutter-unit-tests', status: 'pass', detail: 'test/ directory exists.' }
        : { name: 'flutter-unit-tests', status: 'warning', detail: 'No root test/ directory detected.' });
    } else if (androidProject) {
      add(nativeUnitTests
        ? { name: 'native-unit-tests', status: 'pass', detail: 'A conventional Android unit-test source directory exists.' }
        : { name: 'native-unit-tests', status: 'warning', detail: 'No conventional src/test directory detected; verify module-specific test source sets.' });
    }

    const result = {
      status: blockers.length ? 'blocked' : warnings.length ? 'ready-with-warnings' : 'ready',
      projectPath: root,
      mode: args.requireDevice === false ? 'planning-or-execution-preflight' : 'device-execution-preflight',
      selectedTarget: selectedTarget ? { id: selectedTarget.id, type: selectedTarget.type, model: selectedTarget.model } : null,
      testCases: { total: caseDetails.length, valid: validCases.length, invalid: caseDetails.length - validCases.length, details: caseDetails },
      checks, blockers, warnings,
      safeToStartDeviceWorkflow: blockers.length === 0 && Boolean(selectedTarget || args.requireDevice === false) && validCases.length > 0,
      readOnly: true,
      nextAction: blockers.length ? 'Resolve blockers and rerun validate_test_environment before executing device actions.' : warnings.length ? 'Review warnings, then use run_test_workflow with execute=false before enabling execution.' : 'Review the plan with run_test_workflow execute=false, then execute explicitly.',
    };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

async function exists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
