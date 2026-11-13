import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot } from './paths.js';

const SKIP_DIRS = new Set([
  '.git', '.gradle', '.dart_tool', '.idea', '.testorbit',
  '.android-build-mcp', '.androidbuildmcp', 'node_modules', 'build',
  'Pods', '.symlinks', 'vendor', 'coverage',
]);

export interface FlutterProjectCandidate {
  projectRoot: string;
  pubspecPath: string;
  hasAndroidHost: boolean;
  hasUnitTests: boolean;
  hasIntegrationTests: boolean;
}

export interface WorkspaceProjects {
  workspaceRoot: string;
  flutterProjects: FlutterProjectCandidate[];
  gradleRoots: string[];
}

/** Bounded filesystem discovery for native Android and Flutter monorepos. */
export function discoverWorkspaceProjects(startDir: string = process.cwd()): WorkspaceProjects {
  const workspaceRoot = resolveProjectRoot(startDir);
  const flutterProjects: FlutterProjectCandidate[] = [];
  const gradleRoots: string[] = [];
  const visited = new Set<string>();
  const maxDepth = 7;
  const maxEntries = 12000;
  let entryCount = 0;

  const visit = (dir: string, depth: number): void => {
    if (depth > maxDepth || entryCount >= maxEntries || visited.has(dir)) return;
    visited.add(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entryCount += entries.length;

    const names = new Set(entries.map((entry) => entry.name));
    if (names.has('settings.gradle') || names.has('settings.gradle.kts')) {
      gradleRoots.push(dir);
    }
    if (names.has('pubspec.yaml')) {
      const androidDir = path.join(dir, 'android');
      const hasAndroidHost = fs.existsSync(path.join(androidDir, 'settings.gradle'))
        || fs.existsSync(path.join(androidDir, 'settings.gradle.kts'));
      flutterProjects.push({
        projectRoot: dir,
        pubspecPath: path.join(dir, 'pubspec.yaml'),
        hasAndroidHost,
        hasUnitTests: fs.existsSync(path.join(dir, 'test')),
        hasIntegrationTests: fs.existsSync(path.join(dir, 'integration_test')),
      });
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      visit(path.join(dir, entry.name), depth + 1);
    }
  };

  visit(workspaceRoot, 0);
  flutterProjects.sort((a, b) => a.projectRoot.localeCompare(b.projectRoot));
  gradleRoots.sort((a, b) => a.localeCompare(b));
  return { workspaceRoot, flutterProjects, gradleRoots };
}

/**
 * Resolve a Flutter app root from a package path or a workspace. If multiple
 * Flutter apps are present in a monorepo, prefer the nearest containing app;
 * otherwise return only an unambiguous Android-hosted Flutter app.
 */
export function findFlutterProjectRoot(startDir: string): string | undefined {
  const initial = path.resolve(startDir);
  let dir = initial;
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    // Preserve the supplied path for the workspace-level discovery fallback.
  }
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
      const androidDir = path.join(dir, 'android');
      if (fs.existsSync(androidDir) && fs.statSync(androidDir).isDirectory()) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const discovery = discoverWorkspaceProjects(initial);
  const apps = discovery.flutterProjects.filter((project) => project.hasAndroidHost);
  return apps.length === 1 ? apps[0]?.projectRoot : undefined;
}

/** Return the Gradle root used by Flutter's Android host, or undefined. */
export function flutterAndroidRoot(flutterRoot: string): string | undefined {
  const androidRoot = path.join(flutterRoot, 'android');
  return fs.existsSync(path.join(androidRoot, 'settings.gradle'))
    || fs.existsSync(path.join(androidRoot, 'settings.gradle.kts'))
    ? androidRoot
    : undefined;
}
