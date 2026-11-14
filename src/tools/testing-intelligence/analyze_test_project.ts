import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import { getEffectiveSessionDefaults } from '../../session/defaults.js';
import { discoverWorkspaceProjects } from '../../utils/projectDiscovery.js';
import type { ToolModule } from '../types.js';

export const toolName = 'analyze_test_project';
export const workflow = 'testing-intelligence';
const SKIP = new Set(['.git', '.gradle', '.dart_tool', '.idea', '.testorbit', '.android-build-mcp', '.androidbuildmcp', 'node_modules', 'build', 'Pods', '.symlinks']);
const MARKERS = new Set(['pubspec.yaml', 'pubspec.lock', 'settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'gradlew', 'gradlew.bat', 'AndroidManifest.xml', 'package.json', 'analysis_options.yaml']);
function walk(root: string, rel = '', depth = 0, out: string[] = []): string[] {
  if (depth > 7 || out.length > 12000) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) walk(root, path.join(rel, entry.name), depth + 1, out);
    } else if (entry.isFile()) {
      const file = path.join(rel, entry.name);
      if (MARKERS.has(entry.name) || /\.(kt|kts|java|dart)$/.test(file) || ['test', 'tests', 'androidTest', 'integration_test'].some(part => file.split(path.sep).includes(part))) out.push(file);
    }
  }
  return out;
}
function git(root: string, args: string[]): string[] {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).split(/\r?\n/).filter(Boolean); } catch { return []; }
}
export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Analyze Test Project',
    description: 'Inspect a Native Android or Flutter workspace/monorepo, enumerate Flutter packages and Android Gradle roots, locate tests, and review changed files. Read-only; does not run builds or modify files.',
    inputSchema: { projectPath: z.string().optional().describe('Workspace or package path; auto-discovers the nearest framework config or Git root when omitted.'), baseRef: z.string().optional().describe('Optional Git ref to compare against, e.g. origin/main.') },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; baseRef?: string }) => {
    const requestedPath = args.projectPath ?? getEffectiveSessionDefaults().defaults.projectPath ?? process.cwd();
    const root = resolveProjectRoot(requestedPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project directory does not exist: ${root}`);
    const files = walk(root);
    const relative = (f: string) => f.split(path.sep).join('/');
    const discovery = discoverWorkspaceProjects(root);
    const flutter = discovery.flutterProjects.length > 0 || files.some(f => f.endsWith('.dart'));
    const native = discovery.gradleRoots.length > 0 || files.some(f => /\.(kt|java)$/.test(f));
    const tests = files.filter(f => ['test', 'tests', 'androidTest', 'integration_test'].some(part => relative(f).split('/').includes(part)) || /Test\.(kt|java)$/.test(f));
    const changed = args.baseRef ? git(root, ['diff', '--name-only', `${args.baseRef}...HEAD`]) : git(root, ['status', '--short']);
    const flutterProjects = discovery.flutterProjects.map(project => ({
      path: relative(path.relative(root, project.projectRoot)),
      hasAndroidHost: project.hasAndroidHost,
      hasUnitTests: project.hasUnitTests,
      hasIntegrationTests: project.hasIntegrationTests,
      recommendedUnitCommand: `cd "${project.projectRoot}" && flutter test`,
      recommendedDeviceCommand: project.hasIntegrationTests
        ? `cd "${project.projectRoot}" && flutter test -d <device-id> integration_test`
        : 'Add an integration_test/ directory, then run flutter test -d <device-id> integration_test.',
    }));
    const result = {
      projectRoot: root,
      platforms: { nativeAndroid: native, flutter },
      detectedFiles: files.length,
      gradleRoots: discovery.gradleRoots.map((p) => path.relative(root, p).split(path.sep).join('/') || '.'),
      flutterProjects,
      testFiles: tests.map(relative).slice(0, 500),
      changedFiles: changed,
      recommendations: [
        !tests.length ? 'No conventional test files detected; inspect project-specific test conventions before generating tests.' : 'Reuse existing tests and conventions before generating new ones.',
        flutter ? 'Flutter unit and widget tests can run with flutter test; device integration tests belong under integration_test/ and can run with flutter test -d <device-id> integration_test.' : null,
        native ? 'Native Android: inspect Gradle modules, src/test, src/androidTest, and available device targets.' : null,
        discovery.flutterProjects.length > 1 ? 'Multiple Flutter packages were found. Select the package path explicitly when running tests to avoid testing the wrong app.' : null,
        'Review uncommitted changes before interpreting Git status as the complete change set.',
      ].filter(Boolean),
    };
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}
const mod: ToolModule = { toolName, workflow, register };
export default mod;
