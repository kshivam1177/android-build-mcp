import fs from 'node:fs';
import path from 'node:path';
import { execCommand } from './exec.js';
import { loadConfig } from '../config/loader.js';
import { TestOrbitFrameworkError } from '../types.js';
import type { ExecResult } from '../types.js';

/** Prefer the project's own wrapper (pins the exact Gradle version the
 * project expects); only fall back to a global `gradle` on PATH if no
 * wrapper exists. Respects paths.gradlePath as an explicit override. */
export function resolveGradleCommand(projectPath: string): { command: string; args: string[] } {
  const configured = loadConfig().paths.gradlePath;
  if (configured) return { command: configured, args: [] };

  if (process.platform === 'win32') {
    const wrapper = path.join(projectPath, 'gradlew.bat');
    if (fs.existsSync(wrapper)) return { command: wrapper, args: [] };
  } else {
    const wrapper = path.join(projectPath, 'gradlew');
    if (fs.existsSync(wrapper)) return { command: path.resolve(wrapper), args: [] };
  }
  return { command: 'gradle', args: [] };
}

export function assertGradleProject(projectPath: string): void {
  if (!fs.existsSync(projectPath)) {
    throw new TestOrbitFrameworkError('PROJECT_NOT_FOUND', `No such project path: ${projectPath}`, { projectPath });
  }
  const hasSettings =
    fs.existsSync(path.join(projectPath, 'settings.gradle')) ||
    fs.existsSync(path.join(projectPath, 'settings.gradle.kts'));
  if (!hasSettings) {
    throw new TestOrbitFrameworkError(
      'PROJECT_NOT_FOUND',
      `${projectPath} doesn't look like a Gradle project root (no settings.gradle or settings.gradle.kts).`,
      { projectPath }
    );
  }
}

export interface RunGradleOptions {
  extraArgs?: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export async function runGradle(projectPath: string, tasks: string[], options: RunGradleOptions = {}): Promise<ExecResult> {
  assertGradleProject(projectPath);
  const { command, args: baseArgs } = resolveGradleCommand(projectPath);
  const args = [...baseArgs, ...tasks, '--console=plain', ...(options.extraArgs ?? [])];
  const result = await execCommand(command, args, {
    cwd: projectPath,
    timeoutMs: options.timeoutMs ?? 600_000,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });

  if (result.exitCode !== 0) {
    throw new TestOrbitFrameworkError(
      'GRADLE_BUILD_FAILED',
      `Gradle task(s) "${tasks.join(' ')}" failed with exit code ${result.exitCode}.`,
      { command: result.command, exitCode: result.exitCode, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) }
    );
  }
  return result;
}

/** Mirrors the Android Gradle Plugin's own task-name capitalization rule,
 * e.g. "debug" -> assembleDebug, "devDebug" -> assembleDevDebug. */
export function capitalizeVariant(variant: string): string {
  if (variant.length === 0) return variant;
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

function modulePrefix(module: string): string {
  const trimmed = module.trim();
  if (trimmed === '' || trimmed === ':') return '';
  return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
}

export function assembleTaskName(module: string, variant: string): string {
  return `${modulePrefix(module)}assemble${capitalizeVariant(variant)}`;
}

export function installTaskName(module: string, variant: string): string {
  return `${modulePrefix(module)}install${capitalizeVariant(variant)}`;
}

export function uninstallTaskName(module: string, variant: string): string {
  return `${modulePrefix(module)}uninstall${capitalizeVariant(variant)}`;
}

export function unitTestTaskName(module: string, variant: string): string {
  return `${modulePrefix(module)}test${capitalizeVariant(variant)}UnitTest`;
}

export function connectedTestTaskName(module: string, variant: string): string {
  return `${modulePrefix(module)}connected${capitalizeVariant(variant)}AndroidTest`;
}

export function cleanTaskName(module: string): string {
  const prefix = modulePrefix(module);
  return prefix === '' ? 'clean' : `${prefix}clean`;
}
