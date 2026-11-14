import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfigDir } from '../../config/loader.js';
import { analyzeTestCaseImpact, collectGitChanges, type StoredTestCase } from '../../testing-intelligence/changeImpact.js';
import { compareKnowledgeAssets, readKnowledgeManifest, scanKnowledgeAssets, writeKnowledgeManifest, type KnowledgeManifest } from '../../testing-intelligence/knowledge.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveProjectRoot } from '../../utils/paths.js';
import type { ToolModule } from '../types.js';

export const toolName = 'refresh_test_knowledge';
export const workflow = 'testing-intelligence';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Refresh Persistent Test Knowledge',
    description: 'Index saved test cases, instructions, learned screens, recordings, workflows, and reports into .testorbit/test-knowledge.json. Tracks asset changes since the previous refresh, highlights test cases whose explicit source mappings intersect Git changes, and summarizes known failures without copying failure messages or secrets. Does not execute tests.',
    inputSchema: {
      projectPath: z.string().optional(),
      base: z.string().optional().describe('Git base ref for source-change analysis; defaults to HEAD~1.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: { projectPath?: string; base?: string }) => {
    const projectRoot = resolveProjectRoot(path.resolve(args.projectPath ?? process.cwd()));
    const configDir = getConfigDir(projectRoot);
    const manifestPath = path.join(configDir, 'test-knowledge.json');
    const previous = await readKnowledgeManifest(manifestPath);
    const assets = await scanKnowledgeAssets(configDir);
    const warnings: string[] = [];
    let changedFiles: Array<{ status: string; path: string; previousPath?: string }> = [];
    try {
      const gitAnalysis = await collectGitChanges(projectRoot, args.base ?? 'HEAD~1');
      changedFiles = gitAnalysis.changedFiles;
      if (gitAnalysis.fallbackToBroadRun) warnings.push('Git change analysis could not confidently map every changed file to a test suite.');
    } catch (error) {
      warnings.push(`Git change analysis unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const testCases: StoredTestCase[] = [];
    const testCaseDir = path.join(configDir, 'testcases');
    try {
      const files = (await fs.readdir(testCaseDir)).filter(file => file.endsWith('.json')).sort();
      for (const file of files) {
        try {
          const parsed: unknown = JSON.parse(await fs.readFile(path.join(testCaseDir, file), 'utf8'));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            testCases.push({ ...(parsed as StoredTestCase), file: path.join(testCaseDir, file) });
          } else warnings.push(`Ignored malformed test case: testcases/${file}`);
        } catch {
          warnings.push(`Ignored malformed test case: testcases/${file}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const impact = analyzeTestCaseImpact(changedFiles.map(file => ({
      status: (['added','modified','deleted','renamed','copied'].includes(file.status) ? file.status : 'unknown') as 'added'|'modified'|'deleted'|'renamed'|'copied'|'unknown',
      path: file.path,
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
    })), testCases);
    const staleTestCases = impact.selectedTestCases.map(testCase => ({
      id: testCase.id,
      file: testCase.file ? path.relative(projectRoot, testCase.file).split(path.sep).join('/') : testCase.id,
      changedPaths: testCase.matchedPaths,
    }));
    const latestKnownFailures: KnowledgeManifest['latestKnownFailures'] = [];
    for (const asset of assets.filter(item => item.kind === 'report' && item.path.endsWith('.json')).slice(-200)) {
      try {
        const report = JSON.parse(await fs.readFile(path.join(configDir, asset.path), 'utf8')) as Record<string, unknown>;
        const steps = Array.isArray(report.steps) ? report.steps : Array.isArray(report.results) ? report.results : [];
        const failedSteps = steps.filter((step) => step && typeof step === 'object' && (step as Record<string, unknown>).status === 'failed').length;
        const explicitFailed = report.success === false || report.status === 'failed' || failedSteps > 0;
        if (explicitFailed) latestKnownFailures.push({
          report: asset.path,
          failedSteps,
          ...(typeof report.createdAt === 'string' ? { createdAt: report.createdAt } : typeof report.startedAt === 'string' ? { createdAt: report.startedAt } : {}),
        });
      } catch {
        warnings.push(`Could not parse report metadata: ${asset.path}`);
      }
    }
    latestKnownFailures.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const manifest: KnowledgeManifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projectRoot,
      assets,
      changesSinceLastRefresh: previous ? compareKnowledgeAssets(previous.assets, assets) : { added: assets.map(asset => asset.path), changed: [], removed: [] },
      staleTestCases,
      latestKnownFailures: latestKnownFailures.slice(0, 20),
      warnings,
    };
    await writeKnowledgeManifest(manifestPath, manifest);
    const summary = {
      manifestPath: path.relative(projectRoot, manifestPath).split(path.sep).join('/'),
      assetCount: assets.length,
      countsByKind: Object.fromEntries(['test-case','instruction','screen','recording','workflow','report','other'].map(kind => [kind, assets.filter(asset => asset.kind === kind).length])),
      changesSinceLastRefresh: manifest.changesSinceLastRefresh,
      staleTestCases,
      latestKnownFailures: manifest.latestKnownFailures,
      warnings,
      gitChangedFileCount: changedFiles.length,
    };
    return textResult(JSON.stringify(summary, null, 2), summary);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
