import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { getConfigDir } from '../../config/loader.js';
import { resolveTargetAndBackend } from '../ui-automation/_shared.js';
import { parseUiHierarchy, cacheSnapshot } from '../../automation/uiHierarchy.js';
import { waitForUiAssertion } from '../../automation/waitForUiAssertion.js';
import { auditScreen, type QaIssue } from '../../automation/qaAuditor.js';
import type { ToolModule } from '../types.js';
import type { UiNode } from '../../types.js';

export const toolName = 'run_test_case';
export const workflow = 'testing-intelligence';

export function extractCoordinates(targetStr?: string): { x: number; y: number } | null {
  if (!targetStr) return null;
  // Match patterns like (x: 526, y: 79) or x: 526, y: 79 or (526, 79) or [526, 79]
  const match = targetStr.match(/x\s*:\s*(\d+)\s*,\s*y\s*:\s*(\d+)/i) ||
                targetStr.match(/\((\d+)\s*,\s*(\d+)\)/) ||
                targetStr.match(/\[(\d+)\s*,\s*(\d+)\]/);
  if (match && match[1] && match[2]) {
    return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
  }
  return null;
}

export function findNodesByTarget(nodes: UiNode[], targetStr: string): UiNode[] {
  const lower = targetStr.toLowerCase();
  // 1. Exact match on text or contentDesc
  const exact = nodes.filter(
    (n) => n.text?.toLowerCase() === lower || n.contentDesc?.toLowerCase() === lower || n.resourceId?.toLowerCase() === lower
  );
  if (exact.length) return exact;
  return nodes.filter(
    (n) =>
      (n.text && (lower.includes(n.text.toLowerCase()) || n.text.toLowerCase().includes(lower))) ||
      (n.contentDesc && (lower.includes(n.contentDesc.toLowerCase()) || n.contentDesc.toLowerCase().includes(lower))) ||
      (n.resourceId && n.resourceId.toLowerCase().includes(lower))
  );
}

/** Compatibility helper; execution uses the unique-match resolver below. */
export function findNodeByTarget(nodes: UiNode[], targetStr: string): UiNode | undefined {
  const matches = findNodesByTarget(nodes, targetStr);
  return matches.length === 1 ? matches[0] : undefined;
}

export function recoverySuggestions(message: string, candidates: string[] = []): string[] {
  const lower = message.toLowerCase();
  const suggestions: string[] = [];
  if (lower.includes('ambiguous target')) suggestions.push('Replace the text target with a unique resource ID or content description; do not rely on the first matching element.');
  else if (lower.includes('could not locate target') || lower.includes('target not found')) suggestions.push('Refresh the learned screen definition and update the saved target to a currently visible semantic label or resource ID.');
  if (lower.includes('not connected') || lower.includes('device')) suggestions.push('Check adb devices, unlock the device, and verify the app is in the expected foreground state.');
  if (candidates.length) suggestions.push(`Visible semantic candidates: ${candidates.slice(0, 8).join(', ')}.`);
  if (!suggestions.length) suggestions.push('Inspect the captured screenshot and UI hierarchy evidence before changing the test case.');
  return suggestions;
}

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Run Test Case',
      description:
        'Quickly and effortlessly execute a saved test case from .testorbit/testcases/. Automatically executes each step, continuously audits UI responsiveness, design/layout issues, data anomalies (null/NaN/undefined), and logcat exceptions along the way, and generates a timestamped report.',
      inputSchema: {
        id: z.string().describe('Test case ID, e.g. "TC-FURNITURE-001".'),
        targetId: z.string().optional().describe('Target Android device ID; defaults to session default.'),
        projectPath: z.string().optional().describe('Project root directory; defaults to cwd.'),
        auditEachStep: z.boolean().optional().describe('Continuously monitor screen for design/data/crash issues during execution (default true).'),
        stopOnFailure: z.boolean().optional().describe('Stop immediately if a step fails (default false).'),
        targetRetries: z.number().int().min(0).max(5).optional().describe('Retry semantic target lookup before an action; default 2. Actions are never blindly retried.'),
        captureFailureEvidence: z.boolean().optional().describe('Capture screenshot and hierarchy evidence for failed steps (default true).'),
        assertionTimeoutMs: z.number().int().min(100).max(30_000).optional().default(3000).describe('How long to wait for an explicit expectedOutcome to appear; default 3000ms. UI actions are not retried.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args) => {
      const root = path.resolve(args.projectPath ?? process.cwd());
      const testCasesDir = path.join(getConfigDir(root), 'testcases');
      const slug = args.id
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

      const filePath = path.join(testCasesDir, `${slug}.json`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Test case [${args.id}] not found in ${filePath}. Use list_test_cases to inspect available tests.`);
      }

      const testCase = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const { target, backend } = await resolveTargetAndBackend(args.targetId);

      const steps: Array<any> = Array.isArray(testCase.steps) ? testCase.steps : [];
      const stepResults: Array<{
        stepNumber: number;
        description: string;
        action: string;
        target?: string;
        status: 'PASSED' | 'FAILED' | 'SKIPPED';
        durationMs: number;
        error?: string;
        evidence?: string[];
        recoverySuggestions?: string[];
      }> = [];

      const discoveredIssues: Array<QaIssue & { stepNumber: number }> = [];
      const startTime = Date.now();
      const runId = randomUUID().slice(0, 8);
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
      const reportDir = path.join(getConfigDir(root), 'test-reports', dateStr, `${timeStr}-${runId}`);
      const evidenceDir = path.join(reportDir, 'evidence');
      fs.mkdirSync(reportDir, { recursive: true });

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStart = Date.now();
        const action = (step.action || 'tap').toLowerCase();
        const targetDesc = step.target || step.description || '';
        let latestNodes: UiNode[] = [];

        try {
          // 1. Snapshot UI for this step
          const xml = await backend.dumpHierarchy(target.id);
          const nodes = parseUiHierarchy(xml);
          latestNodes = nodes;
          cacheSnapshot({ targetId: target.id, capturedAt: new Date().toISOString(), backend: backend.name, nodes });

          // 2. Audit screen if enabled
          if (args.auditEachStep !== false) {
            const auditRes = await auditScreen({
              targetId: target.id,
              nodes,
              checkLogs: true,
            });
            for (const iss of auditRes.issues) {
              if (!discoveredIssues.some((d) => d.title === iss.title && d.detail === iss.detail)) {
                discoveredIssues.push({ ...iss, stepNumber: step.stepNumber ?? i + 1 });
              }
            }
          }

          // 3. Execute step action
          if (action === 'tap') {
            const coords = extractCoordinates(targetDesc);
            if (coords) {
              await backend.tap(target.id, coords.x, coords.y);
            } else {
              const maxRetries = args.targetRetries ?? 2;
              let matchedNode: UiNode | undefined;
              let lastCandidates: UiNode[] = [];
              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const currentNodes = attempt === 0 ? nodes : parseUiHierarchy(await backend.dumpHierarchy(target.id));
                latestNodes = currentNodes;
                lastCandidates = findNodesByTarget(currentNodes, targetDesc);
                if (lastCandidates.length === 1) { matchedNode = lastCandidates[0]; break; }
                if (lastCandidates.length > 1) throw new Error(`Ambiguous target "${targetDesc}" matched ${lastCandidates.length} elements. Use a unique resource ID or content description.`);
                if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 400));
              }
              if (!matchedNode) throw new Error(`Could not locate target on screen: "${targetDesc}"`);
              await backend.tap(target.id, matchedNode.centerX, matchedNode.centerY);
            }
          } else if (action === 'type_text') {
            const coords = extractCoordinates(targetDesc);
            if (coords) {
              await backend.tap(target.id, coords.x, coords.y);
            } else if (step.target && targetDesc.trim()) {
              const maxRetries = args.targetRetries ?? 2;
              let matchedNode: UiNode | undefined;
              let lastCandidates: UiNode[] = [];
              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const currentNodes = attempt === 0 ? nodes : parseUiHierarchy(await backend.dumpHierarchy(target.id));
                lastCandidates = findNodesByTarget(currentNodes, targetDesc);
                if (lastCandidates.length === 1) { matchedNode = lastCandidates[0]; break; }
                if (lastCandidates.length > 1) throw new Error(`Ambiguous target "${targetDesc}" matched ${lastCandidates.length} elements. Use a unique resource ID or content description.`);
                if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 400));
              }
              if (!matchedNode) throw new Error(`Could not locate target on screen: "${targetDesc}"`);
              await backend.tap(target.id, matchedNode.centerX, matchedNode.centerY);
            }
            const textToType = step.text || (targetDesc.includes("'") ? targetDesc.split("'")[1] : '') || '';
            if (textToType) {
              await backend.typeText(target.id, textToType);
            }
          } else if (action === 'key_press' || action === 'button') {
            await backend.keyEvent(target.id, step.key || '4'); // default 4 = KEYCODE_BACK
          } else if (action === 'wait_for_ui') {
            await new Promise((r) => setTimeout(r, 1000));
          } else {
            throw new Error(`Unsupported test action "${action}". Supported actions: tap, type_text, key_press, button, wait_for_ui.`);
          }

          // Small delay for animation, then verify an explicit expected UI outcome when supplied.
          await new Promise((r) => setTimeout(r, 400));
          const expectedOutcome = typeof step.expectedOutcome === 'string' ? step.expectedOutcome.trim() : '';
          if (expectedOutcome) {
            const assertion = await waitForUiAssertion(
              async () => parseUiHierarchy(await backend.dumpHierarchy(target.id)),
              expectedOutcome,
              args.assertionTimeoutMs ?? 3000,
            );
            if (!assertion.passed) throw new Error('UI assertion failed: ' + assertion.assertion.message);
          }

          stepResults.push({
            stepNumber: step.stepNumber ?? i + 1,
            description: step.description,
            action,
            target: targetDesc,
            status: 'PASSED',
            durationMs: Date.now() - stepStart,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const stepNumber = step.stepNumber ?? i + 1;
          const evidence: string[] = [];
          if (args.captureFailureEvidence !== false) {
            try {
              fs.mkdirSync(evidenceDir, { recursive: true });
              const screenshot = await backend.screenshot(target.id);
              const screenshotPath = path.join(evidenceDir, `step-${stepNumber}.png`);
              fs.writeFileSync(screenshotPath, screenshot.data);
              evidence.push(path.relative(root, screenshotPath).split(path.sep).join('/'));
            } catch { /* preserve failure details if screenshot capture is unavailable */ }
            try {
              const hierarchy = await backend.dumpHierarchy(target.id);
              const hierarchyPath = path.join(evidenceDir, `step-${stepNumber}.xml`);
              fs.writeFileSync(hierarchyPath, hierarchy, 'utf8');
              evidence.push(path.relative(root, hierarchyPath).split(path.sep).join('/'));
            } catch { /* preserve failure details if hierarchy capture is unavailable */ }
          }
          const visibleCandidates = latestNodes
            .flatMap(node => [node.text, node.contentDesc].filter((value): value is string => Boolean(value && value.trim())))
            .filter((value, index, all) => all.indexOf(value) === index)
            .slice(0, 8);
          stepResults.push({
            stepNumber,
            description: step.description,
            action,
            target: targetDesc,
            status: 'FAILED',
            durationMs: Date.now() - stepStart,
            error: errMsg,
            ...(evidence.length ? { evidence } : {}),
            recoverySuggestions: recoverySuggestions(errMsg, visibleCandidates),
          });

          if (args.stopOnFailure) {
            break;
          }
        }
      }

      const totalDuration = Date.now() - startTime;
      const passedSteps = stepResults.filter((s) => s.status === 'PASSED').length;
      const failedSteps = stepResults.filter((s) => s.status === 'FAILED').length;
      const overallStatus = failedSteps === 0 ? 'PASSED' : 'FAILED';

      const reportMd = [
        `# Test Execution Report: ${testCase.title} (${testCase.id})`,
        '',
        `- **Status**: ${overallStatus}`,
        `- **Execution Time**: ${(totalDuration / 1000).toFixed(2)}s`,
        `- **Device**: ${target.id} (${target.model ?? target.type})`,
        `- **Steps Executed**: ${stepResults.length} (${passedSteps} passed, ${failedSteps} failed)`,
        `- **Discovered Side Findings**: ${discoveredIssues.length}`,
        '',
        '## Step Results',
        '| Step | Action | Target / Description | Status | Duration |',
        '| :--- | :--- | :--- | :--- | :--- |',
        ...stepResults.map(
          (s) =>
            `| ${s.stepNumber} | ${s.action} | ${s.description} | ${s.status === 'PASSED' ? 'PASSED' : 'FAILED'} | ${s.durationMs}ms |`
        ),
        '',
        '## Recovery Guidance',
        ...stepResults.filter(s => s.status === 'FAILED').flatMap(s => [
          `- **Step ${s.stepNumber}**: ${s.recoverySuggestions?.join(' ') ?? 'Inspect failure evidence before editing the test.'}`,
          ...(s.evidence ?? []).map(evidence => `  - Evidence: ${evidence}`),
        ]),
        ...(stepResults.some(s => s.status === 'FAILED') ? [''] : ['- No recovery actions suggested.', '']),
        '## Discovered Side Issues & QA Audits',
        discoveredIssues.length === 0
          ? '*(No side issues detected during execution)*'
          : discoveredIssues
              .map(
                (iss) =>
                  `- **[${iss.severity}] [${iss.category.toUpperCase()}]** (Step ${iss.stepNumber}) ${iss.title}: ${iss.detail}\n  *Recommendation*: ${iss.recommendation ?? 'N/A'}`
              )
              .join('\n'),
        '',
      ].join('\n');

      const reportJson = {
        testCaseId: testCase.id,
        title: testCase.title,
        status: overallStatus,
        durationMs: totalDuration,
        target: { id: target.id, model: target.model, type: target.type },
        stepResults,
        discoveredIssues,
        executedAt: now.toISOString(),
      };

      fs.writeFileSync(path.join(reportDir, 'report.md'), reportMd, 'utf8');
      fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify(reportJson, null, 2), 'utf8');

      const summaryText = [
        `Test [${testCase.id}] ${overallStatus} in ${(totalDuration / 1000).toFixed(2)}s.`,
        `Steps: ${passedSteps}/${stepResults.length} passed.`,
        discoveredIssues.length > 0
          ? `Discovered ${discoveredIssues.length} side issue(s) during execution (check QA section in report).`
          : `Zero side issues or UI glitches detected along the way.`,
        `Report saved to: ${path.join(reportDir, 'report.md')}`,
      ].join('\n');

      return textResult(summaryText, {
        testCaseId: testCase.id,
        status: overallStatus,
        passedSteps,
        totalSteps: stepResults.length,
        discoveredIssuesCount: discoveredIssues.length,
        discoveredIssues,
        reportPath: path.join(reportDir, 'report.md'),
        resultsPath: path.join(reportDir, 'results.json'),
        runId,
        failedSteps: stepResults.filter(s => s.status === 'FAILED').map(s => ({ stepNumber: s.stepNumber, error: s.error, evidence: s.evidence ?? [], recoverySuggestions: s.recoverySuggestions ?? [] })),
      });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
