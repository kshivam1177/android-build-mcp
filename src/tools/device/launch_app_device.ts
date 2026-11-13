import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveTarget, runAdbShell } from '../../utils/adb.js';
import { inspectApk, findBuiltApk, moduleDirFromPath } from '../../utils/apk.js';
import { getEffectiveSessionDefaults } from '../../session/defaults.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'launch_app_device';
export const workflow = 'device';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Launch App',
      description:
        "Launch an already-installed app on the resolved target. Provide packageId directly, or module/variant to look it up from the last build's APK. Uses the app's default launcher activity unless `activity` is given.",
      inputSchema: {
        packageId: z.string().optional().describe('Application id, e.g. "com.example.app". Resolved from the built APK if omitted.'),
        package: z.string().optional().describe('Alias for packageId; launch an installed package without a local APK.'),
        module: z.string().optional(),
        variant: z.string().optional(),
        projectPath: z.string().optional(),
        activity: z.string().optional(),
        targetId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(
      async (args: { packageId?: string; package?: string; module?: string; variant?: string; projectPath?: string; activity?: string; targetId?: string }) => {
        const target = await resolveTarget({ requestedId: args.targetId });

        let packageId = args.packageId ?? args.package;
        let launchableActivity = args.activity;
        if (!packageId) {
          const defaults = getEffectiveSessionDefaults().defaults;
          const projectPath = args.projectPath ?? defaults.projectPath;
          const module = args.module ?? defaults.module;
          const variant = args.variant ?? defaults.variant;
          if (!projectPath || !module || !variant) {
            throw new TestOrbitFrameworkError(
              'INVALID_CONFIG',
              'Provide packageId directly, or projectPath+module+variant (or set sessionDefaults) so the APK can be inspected.'
            );
          }
          const info = await inspectApk(findBuiltApk(moduleDirFromPath(projectPath, module), variant));
          packageId = info.packageName;
          launchableActivity = launchableActivity ?? info.launchableActivity;
        }

        if (launchableActivity) {
          await runAdbShell(target.id, ['am', 'start', '-n', `${packageId}/${launchableActivity}`]);
        } else {
          await runAdbShell(target.id, ['monkey', '-p', packageId, '-c', 'android.intent.category.LAUNCHER', '1']);
        }

        return textResult(`Launched ${packageId} on ${target.id}.`, { target, packageId, activity: launchableActivity });
      }
    )
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
