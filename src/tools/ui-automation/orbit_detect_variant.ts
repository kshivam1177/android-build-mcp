import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DetectVariantUseCase, serialiseDetectionResult } from '../../testorbit/application/detect-variant.js';
import { isPlatform, toScreenId } from '../../testorbit/domain/types.js';
import { TestOrbitError } from '../../testorbit/domain/errors.js';
import { AndroidHierarchyProvider, dumpNodesToCore, readHierarchyDumpFile } from '../../testorbit/infrastructure/hierarchy-provider.js';
import { VariantStore } from '../../testorbit/infrastructure/variant-store.js';
import { dumpHierarchyWithRetry, getScreenSize, resolveTargetAndBackend } from './_shared.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';

export const toolName = 'orbit_detect_variant';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Detect Variant',
    description:
      'Identify the current screen and variant from a fresh hierarchy dump: dump the live hierarchy (or read a hierarchy dump file), run TestOrbit variant detection against the learned screens, and return the identified (screen, variant) with match evidence and diff, or unknown with evidence. Takes a hierarchy dump file or a screenId plus a fresh live dump.',
    inputSchema: {
      screenId: z.string().min(1).max(80).optional(),
      platform: z.string().optional(),
      projectPath: z.string().optional(),
      targetId: z.string().optional(),
      hierarchyFile: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withErrorHandling(async (args: {
    screenId?: string; platform?: string; projectPath?: string; targetId?: string; hierarchyFile?: string;
  }) => {
    const platform = args.platform ?? 'android';
    if (!isPlatform(platform)) {
      throw new TestOrbitError(
        'INVALID_PLATFORM',
        `Unsupported platform "${platform}": expected one of android, ios, flutter, web.`,
        'Pass a supported platform.',
        { platform },
      );
    }
    const projectRoot = path.resolve(args.projectPath ?? process.cwd());
    const store = new VariantStore(projectRoot, platform);
    const useCase = new DetectVariantUseCase(store);
    let nodes;
    let display;
    if (args.hierarchyFile !== undefined) {
      const dump = readHierarchyDumpFile(path.resolve(args.hierarchyFile));
      nodes = dumpNodesToCore(dump);
      display = dump.display;
    } else {
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      const provider = new AndroidHierarchyProvider(
        () => dumpHierarchyWithRetry(backend, target.id),
        () => getScreenSize(target.id),
      );
      nodes = await provider.dumpHierarchy();
      display = await provider.displaySize();
    }
    const screenId = args.screenId !== undefined ? toScreenId(args.screenId) : undefined;
    const result = useCase.detect({
      projectRoot,
      platform,
      nodes,
      display,
      ...(screenId !== undefined ? { screenId } : {}),
    });
    const serialised = serialiseDetectionResult(result);
    let text = JSON.stringify(serialised, null, 2);
    if (result.kind === 'unknown' && screenId !== undefined) {
      text += `\n\nLearn it as a new variant: orbit learn --screen ${screenId} --variantId <variant-name> --platform ${platform}`;
    }
    if (result.kind === 'ambiguous') {
      text += `\n\nAmbiguous match: ${result.candidates.join(', ')} — learn the combined state with orbit learn.`;
    }
    return textResult(text, serialised as unknown as Record<string, unknown>);
  }));
}

const detectVariant: ToolModule = { toolName, workflow, register };

export default detectVariant;
