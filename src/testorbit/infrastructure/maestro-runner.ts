/**
 * Maestro runner (Part D, D1) — the adapter behind the TestOrbit Runner
 * that invokes `maestro test` as a subprocess.
 *
 * One invocation runs the whole flow: `maestro test <yaml> --format
 * junit --output <report.xml> --debug-output <dir>`. The JUnit report
 * is per-flow; per-step timing comes from the `--debug-output`
 * directory (`commands-*.json`: command execution metadata), parsed
 * best-effort — Maestro's debug-output shape is version-dependent, so
 * a missing or unparsable file yields `durationMs: null` for that
 * step and the total duration is always recorded.
 *
 * On this VM Maestro is missing: the runner fails with a clear typed
 * error naming the missing binary (`MAESTRO_NOT_INSTALLED`) and never
 * fakes a run.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RunnerError } from '../domain/errors.js';

/** Per-step timing from Maestro's debug output (best-effort). */
export interface MaestroCommandTiming {
  command: string;
  durationMs: number | null;
  status: 'passed' | 'failed' | 'unknown';
}

/** Outcome of one `maestro test` invocation. */
export interface MaestroRunResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** JUnit report path, or null when Maestro wrote none. */
  junitPath: string | null;
  debugDir: string;
  commandTimings: readonly MaestroCommandTiming[];
}

/** Runs the `maestro` binary; injectable so tests never spawn it. */
export type RunMaestroFn = (args: readonly string[]) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

/** The typed error for a missing Maestro binary. */
function maestroNotInstalled(): RunnerError {
  return new RunnerError(
    'Maestro CLI ("maestro") is not installed or not on PATH, so no test was run.',
    'Install Maestro from https://maestro.mobile.dev (curl -Ls "https://get.maestro.mobile.dev" | bash), then re-run orbit run.',
    { runner: 'maestro' },
  );
}

/**
 * Default command runner: spawns `maestro` via execFile.
 *
 * @param args - Arguments to `maestro`.
 * @returns Stdout, stderr, and the exit code (non-zero is a result, not a throw).
 * @throws RunnerError naming the missing binary when spawn fails with ENOENT.
 */
function defaultRunCommand(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    execFile('maestro', [...args], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ stdout, stderr, exitCode: 0 });
        return;
      }
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        reject(maestroNotInstalled());
        return;
      }
      resolve({ stdout, stderr, exitCode: typeof nodeError.code === 'number' ? nodeError.code : 1 });
    });
  });
}

/** Parse one debug-output commands file into timings (defensive). */
function parseCommandsFile(filePath: string): MaestroCommandTiming[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const timings: MaestroCommandTiming[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const command = typeof record['command'] === 'string' ? record['command'] : typeof record['name'] === 'string' ? record['name'] : 'unknown';
    const durationMs =
      typeof record['durationMs'] === 'number'
        ? record['durationMs']
        : typeof record['duration'] === 'number'
          ? record['duration']
          : null;
    const status = record['status'] === 'passed' || record['status'] === 'failed' ? record['status'] : 'unknown';
    timings.push({ command, durationMs, status });
  }
  return timings;
}

/** Read per-step timings from a Maestro `--debug-output` directory. */
function parseCommandTimings(debugDir: string): MaestroCommandTiming[] {
  if (!fs.existsSync(debugDir)) return [];
  const timings: MaestroCommandTiming[] = [];
  for (const name of fs.readdirSync(debugDir)) {
    if (/^commands-.*\.json$/.test(name)) timings.push(...parseCommandsFile(path.join(debugDir, name)));
  }
  return timings;
}

/** Runs `maestro test` for one generated flow. */
export class MaestroRunner {
  /**
   * @param runCommand - Injectable `maestro` spawner (defaults to execFile).
   */
  constructor(private readonly runCommand: RunMaestroFn = defaultRunCommand) {}

  /**
   * Run one Maestro flow file.
   *
   * @param yamlPath - Absolute path of the generated Maestro YAML.
   * @param reportDir - Directory for the JUnit report and debug output.
   * @returns The run result (success is false on a non-zero exit).
   * @throws RunnerError naming the missing binary when Maestro is not installed.
   */
  async runFlow(yamlPath: string, reportDir: string): Promise<MaestroRunResult> {
    fs.mkdirSync(reportDir, { recursive: true });
    const junitPath = path.join(reportDir, 'report.xml');
    const debugDir = path.join(reportDir, 'debug');
    const started = Date.now();
    const result = await this.runCommand([
      'test',
      yamlPath,
      '--format',
      'junit',
      '--output',
      junitPath,
      '--debug-output',
      debugDir,
    ]);
    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - started,
      junitPath: fs.existsSync(junitPath) ? junitPath : null,
      debugDir,
      commandTimings: parseCommandTimings(debugDir),
    };
  }
}
