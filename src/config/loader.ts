import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, DEFAULT_CONFIG } from './schema.js';
import type { Config } from './schema.js';
import { findProjectConfigPath, PROJECT_CONFIG_DIR, resolveProjectRoot } from '../utils/paths.js';
import { TestOrbitFrameworkError } from '../types.js';

let cachedConfig: Config | null = null;
let cachedConfigPath: string | null | undefined = undefined;

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
  forceReload?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const resolvedPath = options.configPath ?? findProjectConfigPath(options.cwd);

  if (!options.forceReload && cachedConfigPath !== undefined && cachedConfigPath === resolvedPath) {
    return cachedConfig ?? DEFAULT_CONFIG;
  }

  if (!resolvedPath) {
    cachedConfig = DEFAULT_CONFIG;
    cachedConfigPath = null;
    return cachedConfig;
  }

  let raw: unknown;
  try {
    const fileContents = fs.readFileSync(resolvedPath, 'utf8');
    raw = parseYaml(fileContents) ?? {};
  } catch (err) {
    throw new TestOrbitFrameworkError(
      'INVALID_CONFIG',
      `Could not read or parse ${resolvedPath}: ${(err as Error).message}`,
      { path: resolvedPath }
    );
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new TestOrbitFrameworkError('INVALID_CONFIG', `Invalid config at ${resolvedPath}: ${issues}`, {
      path: resolvedPath,
    });
  }

  cachedConfig = result.data;
  cachedConfigPath = resolvedPath;
  return cachedConfig;
}

export function getConfigPath(cwd: string = process.cwd()): string {
  const projectRoot = resolveProjectRoot(path.resolve(cwd));
  return findProjectConfigPath(projectRoot) ?? path.join(projectRoot, PROJECT_CONFIG_DIR, 'config.yaml');
}

export function getConfigDir(cwd: string = process.cwd()): string {
  const projectRoot = resolveProjectRoot(path.resolve(cwd));
  const configPath = findProjectConfigPath(projectRoot);
  if (configPath && path.basename(path.dirname(configPath)) === PROJECT_CONFIG_DIR) {
    return path.dirname(configPath);
  }
  // Read legacy config values if present, but put all new framework data in
  // the canonical directory until the explicit setup --migrate copies old files.
  const resolvedRoot = configPath ? path.dirname(path.dirname(configPath)) : projectRoot;
  return path.join(resolvedRoot, PROJECT_CONFIG_DIR);
}

/** Mostly for tests: drop the cache so the next loadConfig() re-reads disk. */
export function resetConfigCache(): void {
  cachedConfig = null;
  cachedConfigPath = undefined;
}
