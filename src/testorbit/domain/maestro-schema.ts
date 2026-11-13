/**
 * Pinned Maestro schema (Phase 4, Task 0 + C2) — the exact Maestro
 * commands the converter may emit, no more, no less.
 *
 * Pinned command set (9): `launchApp`, `tapOn`, `inputText`,
 * `longPressOn`, `swipe`, `pressKey`, `assertVisible`,
 * `assertNotVisible`, `clearState`. Validation is YAML-parses plus the
 * command whitelist below: a generated file is parsed as two YAML
 * documents (config, then commands) and every command must match one
 * of the nine shapes, or validation fails naming the command.
 *
 * Task 0 findings (code-based; see
 * `src/testorbit/maestro-capability-verification.md`):
 * - Long-press is `longPressOn`, not `longPress` — the plan's C2 name
 *   does not exist in Maestro; the pinned name is `longPressOn`.
 * - Maestro has NO per-command timeout: element lookup is a hardcoded
 *   ~17 s. `timeoutMs` therefore lives in the JSON test case only and
 *   is never emitted into YAML.
 * - Maestro has no syntax-only validation mode: Phase 4 Verify
 *   validates generated YAML with this schema instead of a dry run.
 * - Per-step timing comes from Maestro's `--debug-output` directory
 *   (`commands-*.json`); the JUnit report is per-flow, not per-step.
 */
import { parseAllDocuments, stringify } from 'yaml';
import { z } from 'zod';
import { TestOrbitError } from './errors.js';

/** The nine Maestro commands the converter may emit (C2). */
export const MAESTRO_COMMANDS = [
  'launchApp',
  'tapOn',
  'inputText',
  'longPressOn',
  'swipe',
  'pressKey',
  'assertVisible',
  'assertNotVisible',
  'clearState',
] as const;
export type MaestroCommandName = (typeof MAESTRO_COMMANDS)[number];

/** A Maestro element selector: bare text, `{ id }`, or `{ text }`. */
export const MaestroSelectorSchema = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1) }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
]);
export type MaestroSelector = z.infer<typeof MaestroSelectorSchema>;

/** One Maestro command: exactly one of the nine pinned keys. */
export const MaestroCommandSchema = z.union([
  z
    .object({
      launchApp: z.union([
        z.null(),
        z
          .object({ clearState: z.boolean().optional(), appId: z.string().min(1).optional() })
          .strict(),
      ]),
    })
    .strict(),
  z.object({ tapOn: MaestroSelectorSchema }).strict(),
  z.object({ inputText: z.string() }).strict(),
  z.object({ longPressOn: MaestroSelectorSchema }).strict(),
  z
    .object({
      swipe: z
        .object({
          direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']),
          duration: z.number().int().positive().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ pressKey: z.string().min(1) }).strict(),
  z.object({ assertVisible: MaestroSelectorSchema }).strict(),
  z.object({ assertNotVisible: MaestroSelectorSchema }).strict(),
  z.object({ clearState: z.union([z.null(), z.object({}).strict()]) }).strict(),
]);
export type MaestroCommand = z.infer<typeof MaestroCommandSchema>;

/** The config section of a Maestro flow (before the `---` separator). */
export const MaestroConfigSchema = z
  .object({
    appId: z.string().min(1),
    name: z.string().min(1).optional(),
    onFlowComplete: z.array(z.object({ clearState: z.union([z.null(), z.object({}).strict()]) }).strict()).optional(),
  })
  .strict();
export type MaestroConfig = z.infer<typeof MaestroConfigSchema>;

/** A validated Maestro flow: config + ordered commands. */
export interface MaestroFlow {
  config: MaestroConfig;
  commands: readonly MaestroCommand[];
}

/** The single key of a one-key command object. */
function commandName(command: MaestroCommand): string {
  return Object.keys(command)[0] as string;
}

/** Human-readable Zod issue list for one failed parse. */
function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Validate a Maestro flow's config and commands.
 *
 * @param config - Untrusted config section.
 * @param commands - Untrusted command list.
 * @returns The validated flow.
 * @throws TestOrbitError naming the failing command or field.
 */
export function parseMaestroFlow(config: unknown, commands: unknown): MaestroFlow {
  const parsedConfig = MaestroConfigSchema.safeParse(config);
  if (!parsedConfig.success) {
    throw new TestOrbitError(
      'SCHEMA_VERSION',
      `Invalid Maestro flow config: ${describeIssues(parsedConfig.error)}`,
      'Regenerate the YAML with orbit convert; do not edit generated YAML by hand.',
      {},
    );
  }
  const parsedCommands = z.array(MaestroCommandSchema).safeParse(commands);
  if (!parsedCommands.success) {
    throw new TestOrbitError(
      'SCHEMA_VERSION',
      `Invalid Maestro flow commands: ${describeIssues(parsedCommands.error)}`,
      'Regenerate the YAML with orbit convert; do not edit generated YAML by hand.',
      {},
    );
  }
  return { config: parsedConfig.data, commands: parsedCommands.data };
}

/**
 * Validate generated Maestro YAML text: it must parse as two YAML
 * documents (config, then commands) and pass `parseMaestroFlow`.
 *
 * @param text - Generated YAML text.
 * @returns The validated flow.
 * @throws TestOrbitError naming the failing document, command, or field.
 */
export function parseMaestroYaml(text: string): MaestroFlow {
  let documents;
  try {
    documents = parseAllDocuments(text);
  } catch (error) {
    throw new TestOrbitError(
      'SCHEMA_VERSION',
      `Generated Maestro YAML does not parse: ${error instanceof Error ? error.message : String(error)}`,
      'Regenerate the YAML with orbit convert.',
      {},
    );
  }
  for (const document of documents) {
    if (document.errors.length > 0) {
      throw new TestOrbitError(
        'SCHEMA_VERSION',
        `Generated Maestro YAML does not parse: ${document.errors[0]?.message ?? 'unknown YAML error'}`,
        'Regenerate the YAML with orbit convert.',
        {},
      );
    }
  }
  if (documents.length !== 2) {
    throw new TestOrbitError(
      'SCHEMA_VERSION',
      `Generated Maestro YAML must have exactly 2 documents (config, then commands); found ${documents.length}.`,
      'Regenerate the YAML with orbit convert.',
      {},
    );
  }
  const config = (documents[0] as { toJS: () => unknown }).toJS();
  const commands = (documents[1] as { toJS: () => unknown }).toJS();
  return parseMaestroFlow(config, commands);
}

/**
 * Render a validated flow as YAML text, with the TestOrbit header comment
 * carrying the source JSON hash, generation time, and schema version.
 * The export is one-way/lossy: generated YAML is never re-imported.
 *
 * @param flow - Validated flow to render.
 * @param header - Source hash, generation time, and schema version.
 * @returns The YAML text (config, `---`, commands).
 */
export function renderMaestroYaml(
  flow: MaestroFlow,
  header: { sourceHash: string; generatedAt: string; schemaVersion: 2 },
): string {
  const lines = [
    '# Generated by TestOrbit — one-way/lossy export. Never re-import into JSON.',
    `# sourceJsonSha256: ${header.sourceHash}`,
    `# generatedAt: ${header.generatedAt}`,
    `# schemaVersion: ${header.schemaVersion}`,
    stringify(flow.config).trimEnd(),
    '---',
    stringify([...flow.commands]).trimEnd(),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Name the Maestro command in one command object.
 *
 * @param command - One validated command.
 * @returns Its command name, e.g. `tapOn`.
 */
export function maestroCommandName(command: MaestroCommand): MaestroCommandName {
  return commandName(command) as MaestroCommandName;
}
