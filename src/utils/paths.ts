import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const PROJECT_CONFIG_DIR = '.testorbit';
const LEGACY_CONFIG_DIRS = ['.android-build-mcp', '.androidbuildmcp'] as const;

/**
 * Cross-platform, per-user state directory for runtime state that isn't
 * project config: session-default overrides, log-capture buffers, cached
 * workflow-discovery results. Project config remains project-scoped.
 */
export function getStateDir(): string {
  const platform = process.platform;
  let base: string;
  if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support', 'testorbit');
  } else if (platform === 'win32') {
    base = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'testorbit');
  } else {
    base = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'testorbit');
  }
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function displayPath(absolutePath: string, cwd: string = process.cwd()): string {
  const rel = path.relative(cwd, absolutePath);
  if (rel === '') return '.';
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = os.homedir();
  if (absolutePath.startsWith(home)) return path.join('~', path.relative(home, absolutePath));
  return absolutePath;
}

function isGitMarker(dir: string): boolean {
  // Git worktrees/submodules may use a .git file pointing at the real metadata.
  try {
    const stat = fs.lstatSync(path.join(dir, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the nearest project/workspace root by walking upward from startDir.
 * A canonical framework config or Git root is a project boundary. Legacy
 * config markers remain recognized for existing checkouts. If no marker is
 * found, the resolved start directory is returned as a safe fallback.
 */
export function resolveProjectRoot(startDir: string = process.cwd()): string {
  const initial = path.resolve(startDir);
  let dir = initial;
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    // If a nested path has not been created yet, walk from its nearest
    // existing ancestor for a workspace marker, but keep initial as fallback.
    let probe = dir;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (fs.existsSync(probe)) {
      try {
        if (fs.statSync(probe).isFile()) probe = path.dirname(probe);
      } catch {
        // Fall back to the supplied path below if the ancestor is inaccessible.
      }
      dir = probe;
    }
  }

  for (;;) {
    if (fs.existsSync(path.join(dir, PROJECT_CONFIG_DIR, 'config.yaml'))) return dir;
    if (isGitMarker(dir)) return dir;
    if (LEGACY_CONFIG_DIRS.some((name) => fs.existsSync(path.join(dir, name, 'config.yaml')))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return initial;
    dir = parent;
  }
}

/**
 * Find the canonical config first, while continuing to read either legacy
 * directory so existing projects do not lose access to their saved settings.
 * Stop at the nearest Git boundary so a parent checkout's config is not
 * accidentally applied to a nested, independent repository.
 */
export function findProjectConfigPath(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    // The requested start directory may not exist yet.
  }
  for (;;) {
    const canonical = path.join(dir, PROJECT_CONFIG_DIR, 'config.yaml');
    if (fs.existsSync(canonical)) return canonical;
    for (const legacyName of LEGACY_CONFIG_DIRS) {
      const legacy = path.join(dir, legacyName, 'config.yaml');
      if (fs.existsSync(legacy)) return legacy;
    }
    if (isGitMarker(dir)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Explicitly named alias for callers that need to discover the nearest project root. */
export function findProjectRoot(startDir: string = process.cwd()): string {
  return resolveProjectRoot(startDir);
}
