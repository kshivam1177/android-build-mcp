import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot } from '../../utils/paths.js';
import { findFlutterProjectRoot, flutterAndroidRoot } from '../../utils/projectDiscovery.js';
import { getEffectiveSessionDefaults } from '../../session/defaults.js';
import { TestOrbitFrameworkError } from '../../types.js';

export interface ResolvedBuildParams {
  projectPath: string;
  module: string;
  variant: string;
}

export interface BuildParamArgs {
  projectPath?: string;
  module?: string;
  variant?: string;
}

/** Explicit arg wins; falls back to the active session-default profile;
 * fails loudly (never silently picks a guessed value) if still missing. */
export function resolveBuildParams(args: BuildParamArgs): ResolvedBuildParams {
  const defaults = getEffectiveSessionDefaults().defaults;
  const configuredProjectPath = args.projectPath ?? defaults.projectPath ?? undefined;
  let projectPath = configuredProjectPath
    ? path.resolve(configuredProjectPath)
    : resolveProjectRoot(process.cwd());

  const hasGradleSettings = (dir: string) =>
    fs.existsSync(path.join(dir, 'settings.gradle')) || fs.existsSync(path.join(dir, 'settings.gradle.kts'));
  const flutterRoot = findFlutterProjectRoot(projectPath);
  if (flutterRoot) {
    projectPath = flutterAndroidRoot(flutterRoot) ?? flutterRoot;
  } else if (!hasGradleSettings(projectPath)) {
    const workspaceRoot = resolveProjectRoot(projectPath);
    if (hasGradleSettings(workspaceRoot)) {
      projectPath = workspaceRoot;
    } else {
      const workspaceFlutterRoot = findFlutterProjectRoot(workspaceRoot);
      if (workspaceFlutterRoot) projectPath = flutterAndroidRoot(workspaceFlutterRoot) ?? workspaceFlutterRoot;
    }
  }
  const module = args.module ?? defaults.module ?? undefined;
  const variant = args.variant ?? defaults.variant ?? undefined;

  const missing = [!projectPath && 'projectPath', !module && 'module', !variant && 'variant'].filter(
    (v): v is string => Boolean(v)
  );
  if (missing.length > 0) {
    throw new TestOrbitFrameworkError(
      'INVALID_CONFIG',
      `Missing ${missing.join(', ')}. Pass it explicitly, set sessionDefaults in .testorbit/config.yaml, or call session_set_defaults first.`
    );
  }
  return {
    projectPath: path.resolve(projectPath as string),
    module: module as string,
    variant: variant as string,
  };
}
