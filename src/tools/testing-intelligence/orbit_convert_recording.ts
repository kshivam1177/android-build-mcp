import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import type { ToolModule } from '../types.js';
import { ConvertRecordingUseCase, testIdFromInput } from '../../testorbit/application/convert-recording.js';
import type { GroundedElementOverride } from '../../testorbit/application/annotate-recording.js';
import type { LoadingIndicator } from '../../testorbit/application/maestro-export.js';
import { toElementId, toScreenId, toVariantId } from '../../testorbit/domain/types.js';
import { readRecording } from '../../testorbit/infrastructure/recording-reader.js';
import { VariantStore } from '../../testorbit/infrastructure/variant-store.js';

export const toolName = 'orbit_convert_recording';
export const workflow = 'testing-intelligence';

/** Parse an optional JSON string argument into a value. */
function parseJsonArg(value: string | undefined, name: string): unknown {
  if (value === undefined || value.trim() === '') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${name}: ${(error as Error).message}`);
  }
}

/** Parse the optional loading-indicators JSON argument. */
function parseLoadingIndicators(value: string | undefined): Record<string, LoadingIndicator> | undefined {
  const parsed = parseJsonArg(value, 'loadingIndicatorsJson') as
    | Record<string, { elementId?: unknown; text?: unknown }>
    | undefined;
  if (parsed === undefined) return undefined;
  const indicators: Record<string, LoadingIndicator> = {};
  for (const [screenId, indicator] of Object.entries(parsed)) {
    if (typeof indicator !== 'object' || indicator === null) {
      throw new Error(`Invalid loadingIndicatorsJson: entry for screen "${screenId}" must be an object.`);
    }
    const entry: LoadingIndicator = {};
    if (typeof indicator.elementId === 'string') entry.elementId = toElementId(indicator.elementId);
    if (typeof indicator.text === 'string') entry.text = indicator.text;
    indicators[screenId] = entry;
  }
  return indicators;
}

/** Parse the optional host-agent LLM-vision grounding overrides JSON. */
function parseGroundingOverrides(value: string | undefined): GroundedElementOverride[] | undefined {
  const parsed = parseJsonArg(value, 'groundingOverridesJson') as
    | { actionId?: unknown; elementId?: unknown; screenId?: unknown; variantId?: unknown; detail?: unknown }[]
    | undefined;
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) throw new Error('Invalid groundingOverridesJson: expected a JSON array.');
  return parsed.map((override) => {
    if (typeof override !== 'object' || override === null || typeof override.actionId !== 'string' || typeof override.elementId !== 'string') {
      throw new Error('Invalid groundingOverridesJson: each override needs actionId and elementId strings.');
    }
    const grounded: GroundedElementOverride = {
      actionId: override.actionId,
      elementId: toElementId(override.elementId),
      method: 'llm-vision',
    };
    if (typeof override.screenId === 'string') grounded.screenId = toScreenId(override.screenId);
    if (typeof override.variantId === 'string') grounded.variantId = toVariantId(override.variantId);
    if (typeof override.detail === 'string') grounded.detail = override.detail;
    return grounded;
  });
}

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Convert Recording to Test Case',
      description:
        'Convert a saved recording (schema v1 or v2) into a canonical JSON test case (schemaVersion 2) plus generated Maestro YAML, per the TestOrbit C2 mapping table. Typed values become ${ENV_VAR} references with a <testId>.env.example manifest; assertions are derived mechanically from the recorded screen sequence; unmappable elements fail loudly naming the step.',
      inputSchema: {
        projectPath: z.string().optional().describe('Project root; defaults to cwd.'),
        flowId: z.string().min(1).max(80).describe('Recording id, e.g. "login-flow".'),
        testId: z.string().min(1).max(80).describe('Test case id to write, e.g. "login-flow".'),
        platform: z.enum(['android', 'ios', 'flutter', 'web']).optional().default('android'),
        goal: z.string().optional().describe('Plain-language goal for the test case; defaults to the flow id.'),
        appId: z.string().optional().describe('Maestro app id; falls back to the learned screens\' appPackage.'),
        loadingIndicatorsJson: z.string().optional().describe('Optional JSON object mapping screen id to { elementId?, text? } loading indicators.'),
        groundingOverridesJson: z.string().optional().describe('Optional JSON array of host-agent LLM-vision grounded elements: [{ actionId, elementId, screenId?, variantId?, detail? }].'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrorHandling(async (args) => {
      const projectRoot = path.resolve(args.projectPath ?? process.cwd());
      const platform = args.platform ?? 'android';
      const recording = readRecording(projectRoot, platform, args.flowId);
      const loadingIndicators = parseLoadingIndicators(args.loadingIndicatorsJson);
      const groundingOverrides = parseGroundingOverrides(args.groundingOverridesJson);
      const useCase = new ConvertRecordingUseCase(new VariantStore(projectRoot, platform));
      const result = useCase.convert({
        projectRoot,
        platform,
        recording: recording.document,
        testId: testIdFromInput(args.testId),
        ...(args.goal !== undefined ? { goal: args.goal } : {}),
        ...(args.appId !== undefined ? { appId: args.appId } : {}),
        ...(loadingIndicators !== undefined ? { loadingIndicators } : {}),
        ...(groundingOverrides !== undefined ? { groundingOverrides } : {}),
      });
      return textResult(
        `Converted recording "${args.flowId}" (${recording.edgeNote}) to test case "${args.testId}": ${result.testCase.steps.length} steps, YAML at ${path.relative(projectRoot, result.yamlPath)}, env manifest at ${path.relative(projectRoot, result.envExamplePath)}${result.submitElementId !== null ? `, submit element ${result.submitElementId}` : ''}${result.warnings.length > 0 ? `; warnings: ${result.warnings.join(' ')}` : ''}`,
        {
          testId: args.testId,
          testCasePath: path.relative(projectRoot, result.testCasePath),
          yamlPath: path.relative(projectRoot, result.yamlPath),
          envExamplePath: path.relative(projectRoot, result.envExamplePath),
          envVars: [...result.envVars],
          submitElementId: result.submitElementId,
          warnings: [...result.warnings],
          recordingVersion: recording.version,
          edgeNote: recording.edgeNote,
        },
      );
    }),
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
