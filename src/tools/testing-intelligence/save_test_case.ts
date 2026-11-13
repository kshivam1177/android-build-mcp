import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { getConfigDir } from '../../config/loader.js';
import type { ToolModule } from '../types.js';

export const toolName = 'save_test_case';
export const workflow = 'testing-intelligence';

const StepSchema = z.object({
  stepNumber: z.number().int().positive(),
  description: z.string(),
  action: z.string().optional(),
  target: z.string().optional(),
  expectedOutcome: z.string().optional(),
  timeoutMs: z.number().int().positive().optional().describe('Per-step timeout in ms; defaults to 3000.'),
  assert: z
    .object({
      kind: z.enum(['variant-present', 'visible', 'contains', 'not_visible', 'not_contains']),
      variant: z.string().optional(),
      target: z.string().optional(),
      text: z.string().optional(),
    })
    .optional()
    .describe('Assertion for the step (C1 kinds + payload shapes).'),
});

const SetupSchema = z.object({
  clearAppData: z.boolean(),
  launchApp: z.boolean(),
  disableAnimations: z.boolean(),
});

const TeardownSchema = z.object({ clearAppData: z.boolean() });

const ProvenanceSchema = z.object({
  model: z.string().optional(),
  promptHash: z.string().optional(),
  appVersion: z.string().optional(),
  gitHeadSha: z.string().optional(),
  device: z.string().optional(),
});

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Save Test Case',
      description:
        'Save or update a structured, machine-readable test case definition under .testorbit/testcases/ (schemaVersion 2). Stores pre-conditions, step actions, targets, assertions, setup/teardown, per-step timeoutMs/assert, and provenance metadata.',
      inputSchema: {
        projectPath: z.string().optional().describe('Project root; defaults to cwd.'),
        id: z.string().min(1).max(100).describe('Unique test case identifier, e.g. "TC-FURNITURE-001".'),
        title: z.string().min(1).max(200).describe('Human-readable title of the test case.'),
        description: z.string().min(1).max(2000).describe('Detailed description and goal of the test case.'),
        category: z.string().optional().describe('Category or tag, e.g. "smoke", "cart", "checkout", "e2e".'),
        prerequisites: z.array(z.string()).optional().describe('Prerequisites, e.g. ["User is logged in as Distributor", "Device is unlocked"].'),
        steps: z.array(StepSchema).optional().describe('Ordered list of test steps with actions and expected outcomes.'),
        assertions: z.array(z.string()).optional().describe('Expected verification checks and assertions.'),
        setup: SetupSchema.optional().describe('Setup run before the flow; defaults to clearAppData + launchApp + disableAnimations (C1).'),
        teardown: TeardownSchema.optional().describe('Teardown run after the flow; defaults to clearAppData (C1).'),
        provenance: ProvenanceSchema.optional().describe('Provenance (model, promptHash, appVersion, gitHeadSha, device); "unknown" is used where a value cannot be supplied (C1).'),
        testCaseJson: z.string().optional().describe('Optional custom raw JSON data to merge or store.'),
        overwrite: z.boolean().optional().describe('Must be true to overwrite an existing test case file.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args) => {
      const root = path.resolve(args.projectPath ?? process.cwd());
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`Project directory does not exist: ${root}`);
      }

      const slug = args.id
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

      if (!slug) {
        throw new Error('Test case id must contain at least one valid letter or digit.');
      }

      const dir = path.join(getConfigDir(root), 'testcases');
      fs.mkdirSync(dir, { recursive: true });
      const targetFile = path.join(dir, `${slug}.json`);
      const exists = fs.existsSync(targetFile);

      if (exists && !args.overwrite) {
        throw new Error(`Test case already exists at ${targetFile}. Pass overwrite=true to update it.`);
      }

      let extraData: Record<string, unknown> = {};
      if (args.testCaseJson?.trim()) {
        try {
          extraData = JSON.parse(args.testCaseJson);
        } catch (e) {
          throw new Error(`Invalid testCaseJson: ${(e as Error).message}`);
        }
      }

      const testCaseRecord = {
        schemaVersion: 2,
        id: args.id.trim(),
        title: args.title.trim(),
        description: args.description.trim(),
        category: args.category?.trim() ?? 'general',
        prerequisites: args.prerequisites ?? [],
        steps: (args.steps ?? []).map((step) => ({
          ...step,
          timeoutMs: step.timeoutMs ?? 3000,
        })),
        assertions: args.assertions ?? [],
        setup: args.setup ?? { clearAppData: true, launchApp: true, disableAnimations: true },
        teardown: args.teardown ?? { clearAppData: true },
        provenance: {
          model: args.provenance?.model ?? 'unknown',
          promptHash: args.provenance?.promptHash ?? 'unknown',
          ...(args.provenance?.appVersion !== undefined ? { appVersion: args.provenance.appVersion } : {}),
          ...(args.provenance?.gitHeadSha !== undefined ? { gitHeadSha: args.provenance.gitHeadSha } : {}),
          ...(args.provenance?.device !== undefined ? { device: args.provenance.device } : {}),
        },
        updatedAt: new Date().toISOString(),
        ...extraData,
      };

      const content = `${JSON.stringify(testCaseRecord, null, 2)}\n`;
      fs.writeFileSync(targetFile, content, 'utf8');

      return textResult(`Saved test case [${args.id}] to ${targetFile}`, {
        path: targetFile,
        id: args.id,
        bytes: Buffer.byteLength(content),
        overwritten: exists && Boolean(args.overwrite),
      });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;

