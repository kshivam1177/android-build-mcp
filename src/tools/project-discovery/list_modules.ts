import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'list_modules';
export const workflow = 'project-discovery';

/**
 * Best-effort regex extraction of `include(...)` / `include ...` calls from
 * settings.gradle[.kts]. Handles the common literal-string forms; a settings
 * file that generates includes programmatically (looping over a directory,
 * reading a properties file, etc.) won't be fully detected - a real but
 * narrow limitation of static text parsing vs. actually evaluating the DSL.
 */
function extractIncludes(text: string): string[] {
  const modules = new Set<string>();
  const includeCallRe = /include\s*\(([^)]*)\)/g;
  const includeBareRe = /^\s*include\s+((?:['"]:[^'"]*['"]\s*,?\s*)+)/gm;
  const stringLiteralRe = /['"](:[^'"]*)['"]/g;

  let m: RegExpExecArray | null;
  while ((m = includeCallRe.exec(text)) !== null) {
    const args = m[1] ?? '';
    let sm: RegExpExecArray | null;
    stringLiteralRe.lastIndex = 0;
    while ((sm = stringLiteralRe.exec(args)) !== null) modules.add(sm[1] as string);
  }
  while ((m = includeBareRe.exec(text)) !== null) {
    const args = m[1] ?? '';
    let sm: RegExpExecArray | null;
    stringLiteralRe.lastIndex = 0;
    while ((sm = stringLiteralRe.exec(args)) !== null) modules.add(sm[1] as string);
  }
  return Array.from(modules).sort();
}

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'List Modules',
      description:
        'List Gradle module paths declared in settings.gradle[.kts] via include(...). Static text parsing, not DSL evaluation - a settings file that builds its include list programmatically may not be fully captured.',
      inputSchema: { projectPath: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withErrorHandling(async (args: { projectPath: string }) => {
      const kts = path.join(args.projectPath, 'settings.gradle.kts');
      const groovy = path.join(args.projectPath, 'settings.gradle');
      const settingsPath = fs.existsSync(kts) ? kts : fs.existsSync(groovy) ? groovy : null;
      if (!settingsPath) {
        throw new TestOrbitFrameworkError('PROJECT_NOT_FOUND', `No settings.gradle[.kts] under ${args.projectPath}.`);
      }
      const modules = extractIncludes(fs.readFileSync(settingsPath, 'utf8'));
      return textResult(modules.length > 0 ? modules.join('\n') : '(no include(...) statements found)', {
        settingsPath,
        modules,
      });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
