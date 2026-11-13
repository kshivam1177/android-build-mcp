import fs from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { parseUiHierarchy, cacheSnapshot } from '../../automation/uiHierarchy.js';
import { resolveTargetAndBackend, dumpHierarchyWithRetry } from './_shared.js';
import { createArtifactPath, timestampedArtifactName } from '../../utils/artifacts.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { getEffectiveSessionDefaults } from '../../session/defaults.js';
import type { ToolModule } from '../types.js';
import type { UiSnapshot } from '../../types.js';

export const toolName = 'snapshot_ui';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Snapshot UI',
      description:
        'Capture the current Android accessibility hierarchy and cache short-lived elementRefs. By default, saves the raw hierarchy and complete parsed element tree to .testorbit/artifacts/snapshots/ and returns a compact summary to avoid filling the agent context. Set includeElements=true to return the elements inline.',
      inputSchema: {
        targetId: z.string().optional(),
        projectPath: z.string().optional().describe('Project root; auto-discovers the nearest framework config or Git root when omitted.'),
        interactiveOnly: z
          .boolean()
          .optional()
          .describe('Default true: cache only clickable/focusable/scrollable/checkable elements or elements with text/content descriptions. false caches the full parsed tree.'),
        persist: z.boolean().optional().default(true).describe('Persist raw hierarchy XML and the full parsed tree to a JSON artifact (default true).'),
        includeElements: z.boolean().optional().default(false).describe('Include element objects in the MCP response; default false to keep large trees out of context.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args: {
      targetId?: string;
      projectPath?: string;
      interactiveOnly?: boolean;
      persist?: boolean;
      includeElements?: boolean;
    }) => {
      const { target, backend } = await resolveTargetAndBackend(args.targetId);
      const xml = await dumpHierarchyWithRetry(backend, target.id);
      const allNodes = parseUiHierarchy(xml);
      const interactiveOnly = args.interactiveOnly !== false;
      const nodes = interactiveOnly
        ? allNodes.filter(
            (n) => n.clickable || n.focusable || n.scrollable || n.checkable || Boolean(n.text) || Boolean(n.contentDesc)
          )
        : allNodes;

      const capturedAt = new Date().toISOString();
      const snapshot: UiSnapshot = { targetId: target.id, capturedAt, backend: backend.name, nodes };
      cacheSnapshot(snapshot);

      let artifactPath: string | undefined;
      if (args.persist !== false) {
        const projectRoot = resolveProjectRoot(args.projectPath ?? getEffectiveSessionDefaults().defaults.projectPath ?? process.cwd());
        artifactPath = createArtifactPath(
          projectRoot,
          'snapshots',
          timestampedArtifactName(target.id, 'json')
        );
        const artifact = {
          schemaVersion: 1,
          targetId: target.id,
          capturedAt,
          backend: backend.name,
          source: 'Android accessibility hierarchy',
          rawHierarchyXml: xml,
          totalElementCount: allNodes.length,
          cachedElementCount: nodes.length,
          elements: allNodes,
        };
        fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
      }

      const result: Record<string, unknown> = {
        targetId: target.id,
        backend: backend.name,
        capturedAt,
        elementCount: nodes.length,
        totalElementCount: allNodes.length,
        persisted: args.persist !== false,
        ...(artifactPath ? { artifactPath } : {}),
        elementsIncluded: args.includeElements === true,
        nextStep: artifactPath
          ? 'Read the saved JSON artifact if detailed element data is needed.'
          : 'Call again with persist=true to save the full hierarchy.',
        ...(args.includeElements ? { elements: nodes } : {}),
      };
      const summary = [
        `Captured UI hierarchy for ${target.id}.`,
        `Elements cached: ${nodes.length} (total parsed: ${allNodes.length}).`,
        artifactPath ? `Full hierarchy saved to: ${artifactPath}` : 'Hierarchy persistence disabled.',
        args.includeElements ? 'Element details are included below.' : 'Element details omitted from response; use the artifact path to inspect the full tree.',
      ].join('\n');
      return textResult(summary, result);
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
