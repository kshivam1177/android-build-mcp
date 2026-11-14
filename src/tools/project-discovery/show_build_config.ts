import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { moduleDirFromPath, findBuiltApk, inspectApk } from '../../utils/apk.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'show_build_config';
export const workflow = 'project-discovery';

function bestEffortField(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
}

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Show Build Config',
      description:
        "Report a module's build configuration. If `variant` is given and already built, reads the real applicationId/versionName/versionCode/launchable activity straight from the built APK (aapt2 dump badging) - the most reliable source. Otherwise falls back to best-effort regex extraction from build.gradle[.kts], which can't resolve variables or version-catalog references.",
      inputSchema: {
        projectPath: z.string(),
        module: z.string(),
        variant: z.string().optional().describe('If given and already built, inspects the APK instead of guessing from source.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withErrorHandling(async (args: { projectPath: string; module: string; variant?: string }) => {
      const moduleDir = moduleDirFromPath(args.projectPath, args.module);

      if (args.variant) {
        try {
          const apkPath = findBuiltApk(moduleDir, args.variant);
          const info = await inspectApk(apkPath);
          return textResult(JSON.stringify({ source: 'apk', apkPath, ...info }, null, 2));
        } catch (err) {
          // Fall through to best-effort source parsing if nothing's built yet.
          if (!(err instanceof TestOrbitFrameworkError && err.code === 'FILE_NOT_FOUND')) throw err;
        }
      }

      const kts = path.join(moduleDir, 'build.gradle.kts');
      const groovy = path.join(moduleDir, 'build.gradle');
      const buildFile = fs.existsSync(kts) ? kts : fs.existsSync(groovy) ? groovy : null;
      if (!buildFile) {
        throw new TestOrbitFrameworkError('MODULE_NOT_FOUND', `No build.gradle[.kts] under ${moduleDir}.`);
      }
      const text = fs.readFileSync(buildFile, 'utf8');
      const config = {
        source: 'build.gradle (best-effort text parse)',
        buildFile,
        applicationId: bestEffortField(text, /applicationId\s*[=(]?\s*["']([^"']+)["']/),
        namespace: bestEffortField(text, /namespace\s*[=(]?\s*["']([^"']+)["']/),
        minSdk: bestEffortField(text, /minSdk(?:Version)?\s*[=(]?\s*(\d+)/),
        targetSdk: bestEffortField(text, /targetSdk(?:Version)?\s*[=(]?\s*(\d+)/),
        versionCode: bestEffortField(text, /versionCode\s*[=(]?\s*(\d+)/),
        versionName: bestEffortField(text, /versionName\s*[=(]?\s*["']([^"']+)["']/),
      };
      return textResult(JSON.stringify(config, null, 2));
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
