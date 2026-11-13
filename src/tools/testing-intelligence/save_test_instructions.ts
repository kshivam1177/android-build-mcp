import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { getConfigDir } from '../../config/loader.js';
import type { ToolModule } from '../types.js';
export const toolName = 'save_test_instructions';
export const workflow = 'testing-intelligence';
export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Save Test Instructions',
    description: 'Save or update a named, human-readable test instruction under .testorbit/instructions. Existing files are never overwritten unless overwrite is explicitly true.',
    inputSchema: { projectPath: z.string().optional(), name: z.string().min(1).max(100), instructions: z.string().min(1).max(30000), overwrite: z.boolean().optional().describe('Must be true to replace an existing instruction file.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; name: string; instructions: string; overwrite?: boolean }) => {
    const root = path.resolve(args.projectPath ?? process.cwd());
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project directory does not exist: ${root}`);
    const slug = args.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    if (!slug) throw new Error('Name must contain at least one letter or number.');
    const dir = path.join(getConfigDir(root), 'instructions');
    const target = path.join(dir, `${slug}.md`);
    const existed = fs.existsSync(target);
    if (existed && !args.overwrite) throw new Error(`Instruction already exists at ${target}. Set overwrite=true only after reviewing its contents.`);
    fs.mkdirSync(dir, { recursive: true });
    const content = `# ${args.name.trim()}\n\nUpdated: ${new Date().toISOString()}\n\n${args.instructions.trim()}\n`;
    fs.writeFileSync(target, content, 'utf8');
    return textResult(`Saved test instructions: ${target}`, { path: target, bytes: Buffer.byteLength(content), overwritten: existed && Boolean(args.overwrite) });
  }));
}
const mod: ToolModule = { toolName, workflow, register };
export default mod;
