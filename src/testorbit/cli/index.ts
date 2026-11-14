/**
 * `orbit` CLI entry — dispatches subcommands.
 *
 * Ships `detect`, `learn`, `record`, `convert`, `run`, `copy`,
 * `generate-map`, `check`, and `rename-screen` (Part D, D1). Flags are `--key value` pairs; `--platform` defaults
 * to `android` and `--project` defaults to the current working
 * directory. `record` is dry-run by default (writes nothing).
 *
 * Output goes through `process.stdout.write` / `process.stderr.write`
 * (no `console.log` in TestOrbit code, Part D).
 */
import path from 'node:path';
import { AndroidHierarchyProvider } from '../infrastructure/hierarchy-provider.js';
import { runCheckCommand } from './commands/check.js';
import { runConvertCommand, convertTestIdFromCli } from './commands/convert.js';
import { runCopyCommand, copyTestIdFromCli } from './commands/copy.js';
import { runDetectCommand, screenIdFromCli } from './commands/detect.js';
import { runGenerateMapCommand } from './commands/generate-map.js';
import { runLearnCommand, learnScreenIdFromCli, variantIdFromCli } from './commands/learn.js';
import { runRecordCommand } from './commands/record.js';
import { runRenameScreenCommand, renameFromScreenIdFromCli, renameToScreenIdFromCli } from './commands/rename-screen.js';
import { runRunCommand, runTestIdFromCli } from './commands/run.js';
import { toElementId } from '../domain/types.js';
import { isPlatform } from '../domain/types.js';
import type { Platform } from '../domain/types.js';
import { dumpHierarchyWithRetry, getScreenSize, resolveTargetAndBackend } from '../../tools/ui-automation/_shared.js';

/** Parsed CLI flags: `--key value` pairs plus positional arguments. */
interface ParsedArgs {
  positionals: string[];
  flags: ReadonlyMap<string, string>;
}

/** Split argv into positionals and `--key value` flags. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('--')) {
        flags.set(arg.slice(2), value);
        i += 1;
      } else {
        flags.set(arg.slice(2), 'true');
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

/** Usage text for the CLI. */
function usage(): string {
  return [
    'Usage: orbit <command> [options]',
    '',
    'Commands:',
    '  detect --screen <id> [--platform <platform>] [--project <path>]',
    '         [--target <id>] [--hierarchy-file <path>]',
    '         Dump the live hierarchy, run variant detection, print the',
    '         variant id or unknown with evidence.',
    '  learn --screen <id> --variantId <name> [--required <a,b>]',
    '        [--learned-from <text>] [--platform <platform>]',
    '        [--project <path>] [--target <id>] [--hierarchy-file <path>]',
    '        Learn one variant of a screen from a hierarchy dump.',
    '  record --plan-file <path> [--no-dry-run] [--platform <platform>]',
    '         [--project <path>]',
    '         Print the plan that would be recorded (dry-run is the',
    '         default); writes nothing. Live recording is via MCP.',
    '  convert --recording <flowId> --test <testId> [--goal <text>]',
    '          [--app-id <id>] [--platform <platform>] [--project <path>]',
    '          Convert a recording to a JSON test case + Maestro YAML.',
    '  run --test <testId> [--platform <platform>] [--project <path>]',
    '      [--target <id>] [--hierarchy-file <path>]',
    '      Pre-flow detection, then maestro test, then the failure bundle.',
    '  copy --test <testId> --from <platform> --to <platform>',
    '       [--as <newTestId>] [--project <path>]',
    '       Copy a test across platform folders, re-resolving elements.',
    '  generate-map [--platform <platform>] [--project <path>]',
    '       Generate <platform>/screen-map.json from learned screens',
    '       and v2 recordings (edges proved by navigation steps).',
    '  check [--platform <platform>] [--project <path>]',
    '       Check the screen map and learned screens (check-screen-map);',
    '       exit 1 when any rule fails.',
    '  rename-screen --screen <old> --to <new>',
    '       [--platform <platform>] [--project <path>]',
    '       Rename a screen id and rewrite every reference to it,',
    '       then regenerate the map.',
    '',
  ].join('\n');
}

/**
 * Build a live Android hierarchy provider from the connected target.
 *
 * @param targetId - Optional target id; the default target when omitted.
 * @returns The provider wrapping the backend dump + screen size.
 */
async function liveProvider(targetId: string | undefined): Promise<AndroidHierarchyProvider> {
  const { target, backend } = await resolveTargetAndBackend(targetId);
  return new AndroidHierarchyProvider(
    () => dumpHierarchyWithRetry(backend, target.id),
    () => getScreenSize(target.id),
  );
}

/** Dispatch `orbit learn` from parsed flags. */
async function runLearnCli(
  projectRoot: string,
  platform: Platform,
  flags: ReadonlyMap<string, string>,
  hierarchyFile: string | undefined,
): Promise<number> {
  const screenFlag = flags.get('screen');
  const variantFlag = flags.get('variantId');
  if (screenFlag === undefined || variantFlag === undefined) {
    process.stdout.write('orbit learn needs --screen <id> --variantId <name>\n');
    return 1;
  }
  const requiredFlag = flags.get('required');
  const learnedFrom = flags.get('learned-from');
  const provider = hierarchyFile === undefined ? await liveProvider(flags.get('target')) : undefined;
  return runLearnCommand({
    projectRoot,
    platform,
    screenId: learnScreenIdFromCli(screenFlag),
    variantId: variantIdFromCli(variantFlag),
    ...(requiredFlag !== undefined
      ? { requiredIds: requiredFlag.split(',').map((id) => toElementId(id.trim())) }
      : {}),
    ...(learnedFrom !== undefined ? { learnedFrom } : {}),
    ...(hierarchyFile !== undefined ? { hierarchyFile } : {}),
    ...(provider !== undefined ? { hierarchyProvider: provider } : {}),
  });
}

/** Dispatch `orbit record` from parsed flags. */
async function runRecordCli(
  projectRoot: string,
  platform: Platform,
  flags: ReadonlyMap<string, string>,
): Promise<number> {
  const planFile = flags.get('plan-file');
  if (planFile === undefined) {
    process.stdout.write('orbit record needs --plan-file <path>\n');
    return 1;
  }
  return runRecordCommand({
    projectRoot,
    platform,
    planFile,
    dryRun: flags.get('no-dry-run') !== 'true',
  });
}

/** Dispatch `orbit convert` from parsed flags. */
async function runConvertCli(
  projectRoot: string,
  platform: Platform,
  flags: ReadonlyMap<string, string>,
): Promise<number> {
  const flowId = flags.get('recording');
  const testFlag = flags.get('test');
  if (flowId === undefined || testFlag === undefined) {
    process.stdout.write('orbit convert needs --recording <flowId> --test <testId>\n');
    return 1;
  }
  const goal = flags.get('goal');
  const appId = flags.get('app-id');
  return runConvertCommand({
    projectRoot,
    platform,
    flowId,
    testId: convertTestIdFromCli(testFlag),
    ...(goal !== undefined ? { goal } : {}),
    ...(appId !== undefined ? { appId } : {}),
  });
}

/** Dispatch `orbit run` from parsed flags. */
async function runRunCli(
  projectRoot: string,
  platform: Platform,
  flags: ReadonlyMap<string, string>,
  hierarchyFile: string | undefined,
): Promise<number> {
  const testFlag = flags.get('test');
  if (testFlag === undefined) {
    process.stdout.write('orbit run needs --test <testId>\n');
    return 1;
  }
  const provider = hierarchyFile === undefined ? await liveProvider(flags.get('target')) : undefined;
  return runRunCommand({
    projectRoot,
    platform,
    testId: runTestIdFromCli(testFlag),
    ...(hierarchyFile !== undefined ? { hierarchyFile } : {}),
    ...(provider !== undefined ? { hierarchyProvider: provider } : {}),
  });
}

/** Dispatch `orbit copy` from parsed flags. */
async function runCopyCli(
  projectRoot: string,
  flags: ReadonlyMap<string, string>,
): Promise<number> {
  const testFlag = flags.get('test');
  const fromFlag = flags.get('from');
  const toFlag = flags.get('to');
  if (testFlag === undefined || fromFlag === undefined || toFlag === undefined) {
    process.stdout.write('orbit copy needs --test <testId> --from <platform> --to <platform>\n');
    return 1;
  }
  const fromPlatform: Platform = isPlatform(fromFlag) ? fromFlag : 'android';
  const toPlatform: Platform = isPlatform(toFlag) ? toFlag : 'android';
  const asFlag = flags.get('as');
  return runCopyCommand({
    projectRoot,
    fromPlatform,
    toPlatform,
    testId: copyTestIdFromCli(testFlag),
    ...(asFlag !== undefined ? { newTestId: copyTestIdFromCli(asFlag) } : {}),
  });
}

/**
 * Run the CLI from argv (without the `node` / script entries).
 *
 * @param argv - Command-line arguments after the script name.
 * @returns The process exit code.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const projectRoot = path.resolve(flags.get('project') ?? process.cwd());
  const platformFlag = flags.get('platform') ?? 'android';
  const platform: Platform = isPlatform(platformFlag) ? platformFlag : 'android';
  const hierarchyFile = flags.get('hierarchy-file');
  if (command === 'detect') {
    const screenFlag = flags.get('screen');
    const provider = hierarchyFile === undefined ? await liveProvider(flags.get('target')) : undefined;
    return runDetectCommand({
      projectRoot,
      platform,
      ...(screenFlag !== undefined ? { screenId: screenIdFromCli(screenFlag) } : {}),
      ...(hierarchyFile !== undefined ? { hierarchyFile } : {}),
      ...(provider !== undefined ? { hierarchyProvider: provider } : {}),
    });
  }
  if (command === 'learn') return runLearnCli(projectRoot, platform, flags, hierarchyFile);
  if (command === 'record') return runRecordCli(projectRoot, platform, flags);
  if (command === 'convert') return runConvertCli(projectRoot, platform, flags);
  if (command === 'run') return runRunCli(projectRoot, platform, flags, hierarchyFile);
  if (command === 'copy') return runCopyCli(projectRoot, flags);
  if (command === 'generate-map') {
    return runGenerateMapCommand({ projectRoot, platform });
  }
  if (command === 'check') {
    return runCheckCommand({ projectRoot, platform });
  }
  if (command === 'rename-screen') {
    const screenFlag = flags.get('screen');
    const toFlag = flags.get('to');
    if (screenFlag === undefined || toFlag === undefined) {
      process.stdout.write('orbit rename-screen needs --screen <old> --to <new>\n');
      return 1;
    }
    return runRenameScreenCommand({
      projectRoot,
      platform,
      fromScreenId: renameFromScreenIdFromCli(screenFlag),
      toScreenId: renameToScreenIdFromCli(toFlag),
    });
  }
  process.stdout.write(usage());
  return command === undefined ? 0 : 1;
}

/** CLI main: run and set the process exit code. */
async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`orbit: ${message}\n`);
    process.exitCode = 1;
  }
}

void main();
