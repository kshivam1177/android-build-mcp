/**
 * Report writer tests — replay LLM calls are always 0, and the
 * failure bundle redacts secrets at the write boundary.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRunReport, createRunDir, readRunCoverage, writeFailureBundle, writeRunReport } from './report.js';
import { toScreenId, toVariantId } from '../domain/types.js';
import { getPlatformDir } from '../infrastructure/filesystem.js';

/** Minimal valid screen map carrying a coverage block. */
function mapWithCoverage(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    platform: 'android',
    generatedAt: '2026-11-13T00:00:00.000Z',
    screens: [{ screenId: 'login', variants: ['login.default'], elementCount: 4 }],
    edges: [],
    coverage: {
      screensLearned: 1,
      variantsLearned: 1,
      edgeCount: 0,
      screensNeverTraversed: ['login'],
      variantsNeverTraversed: ['login.default'],
    },
  };
}

describe('run report', () => {
  it('always records 0 LLM calls for the replay portion', () => {
    const report = buildRunReport({
      testId: 'login-flow',
      platform: 'android',
      startedAt: '2026-11-13T00:00:00.000Z',
      durationMs: 1000,
      success: true,
      llmCallsPlan: 3,
      llmCallsRecord: 5,
      steps: [{ index: 1, command: 'tapOn', status: 'passed', durationMs: 120 }],
    });
    expect(report.llmCalls).toEqual({ plan: 3, record: 5, replay: 0 });
  });

  it('writes the report into a run directory', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-report-'));
    try {
      const { dir } = createRunDir(projectRoot, 'android');
      const report = buildRunReport({
        testId: 'login-flow',
        platform: 'android',
        startedAt: '2026-11-13T00:00:00.000Z',
        durationMs: 10,
        success: true,
        llmCallsPlan: 0,
        llmCallsRecord: 0,
        steps: [],
      });
      const reportPath = writeRunReport(dir, report);
      expect(fs.existsSync(reportPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { testId: string }).toEqual(
        expect.objectContaining({ testId: 'login-flow' }),
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

/** Write one screen-map file into a temp project tree. */
function writeMapFile(projectRoot: string, content: string): void {
  const platformDir = getPlatformDir(projectRoot, 'android');
  fs.mkdirSync(platformDir, { recursive: true });
  fs.writeFileSync(path.join(platformDir, 'screen-map.json'), content, 'utf8');
}

/** Build a report with the coverage block attached. */
function reportWithCoverage(): ReturnType<typeof buildRunReport> {
  return buildRunReport({
    testId: 'login-flow',
    platform: 'android',
    startedAt: '2026-11-13T00:00:00.000Z',
    durationMs: 1000,
    success: true,
    llmCallsPlan: 0,
    llmCallsRecord: 0,
    steps: [],
    coverage: {
      screensLearned: 2,
      variantsLearned: 3,
      edgeCount: 1,
      screensNeverTraversed: [toScreenId('settings')],
      variantsNeverTraversed: [toVariantId('settings.default')],
    },
  });
}

describe('run report coverage block', () => {
  it('attaches the map coverage block when provided', () => {
    expect(reportWithCoverage().coverage).toEqual({
      screensLearned: 2,
      variantsLearned: 3,
      edgeCount: 1,
      screensNeverTraversed: ['settings'],
      variantsNeverTraversed: ['settings.default'],
    });
  });

  it('omits the coverage block when no map was read', () => {
    const report = buildRunReport({
      testId: 'login-flow',
      platform: 'android',
      startedAt: '2026-11-13T00:00:00.000Z',
      durationMs: 10,
      success: true,
      llmCallsPlan: 0,
      llmCallsRecord: 0,
      steps: [],
    });
    expect(report.coverage).toBeUndefined();
  });
});

describe('readRunCoverage', () => {
  it('reads the coverage block from the platform screen map', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-coverage-'));
    try {
      writeMapFile(projectRoot, `${JSON.stringify(mapWithCoverage(), null, 2)}\n`);
      expect(readRunCoverage(projectRoot, 'android')).toEqual({
        screensLearned: 1,
        variantsLearned: 1,
        edgeCount: 0,
        screensNeverTraversed: ['login'],
        variantsNeverTraversed: ['login.default'],
      });
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns undefined when the tree has no map yet', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-coverage-'));
    try {
      expect(readRunCoverage(projectRoot, 'android')).toBeUndefined();
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns undefined for an unreadable or invalid map, never throwing', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-coverage-'));
    try {
      writeMapFile(projectRoot, '{ not json');
      expect(readRunCoverage(projectRoot, 'android')).toBeUndefined();
      writeMapFile(projectRoot, `${JSON.stringify({ schemaVersion: 99 })}\n`);
      expect(readRunCoverage(projectRoot, 'android')).toBeUndefined();
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('failure bundle', () => {
  it('redacts secrets from the diff summary', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-bundle-'));
    try {
      const { dir } = createRunDir(projectRoot, 'android');
      const bundlePath = writeFailureBundle(
        dir,
        {
          schemaVersion: 2,
          testId: 'login-flow',
          platform: 'android',
          failedStep: 1,
          expected: { screen: 'login', variant: 'login.password' },
          actual: { screen: null, variant: null, diffSummary: 'typed hunter2 into the field', checkedVariants: [] },
          hierarchyPath: path.join(dir, 'hierarchy.json'),
          screenshotPath: null,
          rerunCommand: 'orbit run --test login-flow --platform android',
          createdAt: '2026-11-13T00:00:00.000Z',
        },
        ['hunter2'],
      );
      const text = fs.readFileSync(bundlePath, 'utf8');
      expect(text).not.toContain('hunter2');
      expect(text).toContain('[REDACTED]');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
