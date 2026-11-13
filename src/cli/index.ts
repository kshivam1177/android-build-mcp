#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../mcp/server.js';
import { WORKFLOWS } from '../workflows.js';
import { runDoctorChecks } from '../tools/doctor/doctor.js';
import { getConfigDir } from '../config/loader.js';
import { PROJECT_CONFIG_DIR, findProjectConfigPath, resolveProjectRoot } from '../utils/paths.js';
import { runSelfUpdate } from './update.js';
import { chooseCodingAgent, generateAgentSkill, SUPPORTED_AGENTS, type CodingAgent } from './skills.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function runMcp(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runDoctor(): Promise<void> {
  const { summary, checks } = await runDoctorChecks();
  console.log(summary);
  for (const check of checks) {
    const status = check.ok ? 'OK  ' : check.required ? 'FAIL' : 'skip';
    console.log(`  [${status}] ${check.name}: ${check.detail}`);
  }
  process.exitCode = checks.some((c) => c.required && !c.ok) ? 1 : 0;
}

function runUpdate(): void {
  const packageRoot = path.resolve(moduleDir, '..', '..');
  const result = runSelfUpdate(packageRoot);
  if (!result.success) process.exitCode = 1;
}

function listWorkflows(): void {
  for (const w of WORKFLOWS) {
    console.log(`${w.name} (${w.tools.length} tools)${w.defaultEnabled ? ' [enabled by default]' : ''}`);
    console.log(`  ${w.description}`);
  }
}

function listTools(json: boolean): void {
  if (json) {
    const all = WORKFLOWS.flatMap((w) => w.tools.map((t) => ({ tool: t.toolName, workflow: w.name })));
    console.log(JSON.stringify(all, null, 2));
    return;
  }
  for (const w of WORKFLOWS) {
    console.log(`\n${w.name}:`);
    for (const t of w.tools) console.log(`  ${t.toolName}`);
  }
}

function writeSetupGuide(directory: string): void {
  const guidePath = path.join(directory, 'SETUP.md');
  if (fs.existsSync(guidePath)) {
    console.log(`Setup guide already exists at ${guidePath} - leaving it unchanged.`);
    return;
  }

  const packageRoot = path.resolve(moduleDir, '..', '..');
  const packagedGuide = path.join(packageRoot, 'docs', 'project-setup-guide.md');
  const fallbackGuide = [
    '# TestOrbit — Project Setup',
    '',
    '1. Run `testorbit doctor` to check Android SDK, adb, Java, Gradle, and devices.',
    '2. Configure `enabledWorkflows` and `sessionDefaults` in `config.yaml`.',
    '3. Restart your MCP client after changing the configuration.',
    '4. Use `testorbit tools` to list available MCP tools.',
    '5. Reports and artifacts are stored under `.testorbit/` in your project.',
    '',
    'See the project README and docs for MCP client configuration examples.',
    '',
  ].join('\\n');
  const contents = fs.existsSync(packagedGuide) ? fs.readFileSync(packagedGuide, 'utf8') : fallbackGuide;
  fs.writeFileSync(guidePath, contents, { encoding: 'utf8', flag: 'wx' });
  console.log(`Wrote setup guide: ${guidePath}`);
}

function setupConfig(cwd: string, migrate: boolean): void {
  const projectRoot = resolveProjectRoot(cwd);
  const canonicalDir = path.join(projectRoot, PROJECT_CONFIG_DIR);
  const canonicalPath = path.join(canonicalDir, 'config.yaml');
  const existingCanonical = fs.existsSync(canonicalPath);
  const legacyPath = findProjectConfigPath(projectRoot);

  if (existingCanonical) {
    console.log(`${canonicalPath} already exists - leaving it as-is.`);
    writeSetupGuide(canonicalDir);
    return;
  }

  if (legacyPath && legacyPath !== canonicalPath) {
    if (!migrate) {
      console.log(`Found existing config at ${legacyPath}.`);
      console.log(`Run "testorbit setup --migrate" to copy legacy project data into ${canonicalDir}; existing files will never be overwritten.`);
      writeSetupGuide(path.dirname(legacyPath));
      return;
    }
    fs.mkdirSync(canonicalDir, { recursive: true });
    fs.cpSync(path.dirname(legacyPath), canonicalDir, { recursive: true, errorOnExist: true, force: false });
    console.log(`Migrated project configuration from ${path.dirname(legacyPath)} to ${canonicalDir} without overwriting files.`);
    writeSetupGuide(canonicalDir);
    return;
  }

  fs.mkdirSync(canonicalDir, { recursive: true });
  const examplePath = path.resolve(moduleDir, '..', '..', 'config.example.yaml');
  const contents = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, 'utf8')
    : 'schemaVersion: 1\\nenabledWorkflows: [device, ui-automation, session-management, doctor, workflow-discovery, testing-intelligence, debugging]\\n';
  fs.writeFileSync(canonicalPath, contents, { encoding: 'utf8', flag: 'wx' });
  console.log(`Wrote ${canonicalPath}.`);
  writeSetupGuide(canonicalDir);
  console.log('Edit enabledWorkflows and sessionDefaults for your project, then restart your MCP client.');
}

async function generateSkillCommand(cwd: string, requestedAgent?: string): Promise<void> {
  const projectRoot = resolveProjectRoot(cwd);
  try {
    const agent = await chooseCodingAgent(projectRoot, requestedAgent);
    const result = generateAgentSkill(projectRoot, agent);
    console.log(result.created ? `Created coding-agent skill: ${result.filePath}` : `Skill already exists; left unchanged: ${result.filePath}`);
    console.log(`Agent selected: ${agent}. The skill teaches the agent to use TestOrbit and preserve test evidence.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function setupProject(cwd: string, migrate: boolean, requestedAgent?: string): Promise<void> {
  setupConfig(cwd, migrate);
  await generateSkillCommand(cwd, requestedAgent);
}

const cliArgs = hideBin(process.argv);
if (path.basename(process.argv[1] ?? '') === 'skill-gen') cliArgs.unshift('skill-gen');

await yargs(cliArgs)
  .scriptName('testorbit')
  .command('mcp', 'Start the MCP server over stdio (for MCP clients)', () => {}, runMcp)
  .command('doctor', 'Check the local Android toolchain (adb, java, gradle, SDK, emulator)', () => {}, runDoctor)
  .command('update', 'Update testorbit if a newer npm version exists and clear the npx execution cache', () => {}, runUpdate)
  .command('workflows', 'List every workflow, its tool count, and whether it is on by default', () => {}, listWorkflows)
  .command(
    'tools',
    'List every tool, grouped by workflow',
    (y) => y.option('json', { type: 'boolean', default: false, describe: 'Emit machine-readable JSON instead' }),
    (argv) => listTools(Boolean(argv.json))
  )
  .command(
    'setup',
    'Initialize .testorbit/ in the current project; use --migrate to copy legacy files safely',
    (y) => y
      .option('migrate', { type: 'boolean', default: false, describe: 'Copy files from a legacy project directory without overwriting existing files' })
      .option('agent', { type: 'string', choices: SUPPORTED_AGENTS as unknown as string[], describe: 'Coding agent to configure; otherwise ask in the terminal or auto-detect' }),
    (argv) => setupProject(process.cwd(), Boolean(argv.migrate), argv.agent as CodingAgent | undefined)
  )
  .command(
    'skill-gen',
    'Generate an TestOrbit skill file for your coding agent',
    (y) => y.option('agent', { type: 'string', choices: SUPPORTED_AGENTS as unknown as string[], describe: 'Agent: claude, codex, gemini, antigravity, cursor, copilot, other, or auto' }),
    (argv) => generateSkillCommand(process.cwd(), argv.agent as CodingAgent | undefined)
  )
  .demandCommand(1, 'Pass a command - try "testorbit --help".')
  .strict()
  .help()
  .parseAsync();
