import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { getConfigDir } from '../../config/loader.js';
import type { ToolModule } from '../types.js';

export const toolName = 'list_test_cases';
export const workflow = 'testing-intelligence';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'List Test Cases',
      description:
        'List all structured test cases stored in .testorbit/testcases/, optionally filtered by category.',
      inputSchema: {
        projectPath: z.string().optional().describe('Project root; defaults to cwd.'),
        category: z.string().optional().describe('Optional category filter, e.g. "cart", "checkout", "smoke".'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withErrorHandling(async (args) => {
      const root = path.resolve(args.projectPath ?? process.cwd());
      const dir = path.join(getConfigDir(root), 'testcases');

      if (!fs.existsSync(dir)) {
        return textResult('No test cases directory found in .testorbit/testcases/.', {
          count: 0,
          testCases: [],
        });
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      const testCases = [];

      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(raw);
          if (args.category && data.category?.toLowerCase() !== args.category.toLowerCase().trim()) {
            continue;
          }
          testCases.push({
            id: data.id ?? path.basename(file, '.json'),
            title: data.title ?? '',
            category: data.category ?? 'general',
            description: data.description ?? '',
            stepCount: Array.isArray(data.steps) ? data.steps.length : 0,
            assertionCount: Array.isArray(data.assertions) ? data.assertions.length : 0,
            updatedAt: data.updatedAt ?? null,
            file: filePath,
          });
        } catch {
          // ignore corrupted files or continue
        }
      }

      const summary =
        testCases.length === 0
          ? 'No matching test cases found in .testorbit/testcases/.'
          : `Found ${testCases.length} test case(s) in ${dir}:\n` +
            testCases
              .map((tc) => `• [${tc.id}] ${tc.title} (${tc.category}, ${tc.stepCount} steps)`)
              .join('\n');

      return textResult(summary, {
        count: testCases.length,
        testCases,
      });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;

