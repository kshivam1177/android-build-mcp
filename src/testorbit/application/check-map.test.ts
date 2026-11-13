/**
 * `check-screen-map` tests, part 1 (Phase 6, C3/C16) — passes on the
 * clean tree, warns (never fails) on a screen with no edges, and fails
 * with the exact rule named for a dangling edge, a stale edge, a split
 * with no migration list, and <80% stable coverage. Fixtures only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toScreenId } from '../domain/types.js';
import {
  checkMap,
  failRules,
  generateMap,
  screenDirFor,
  writeElementsBackup,
  writeFixtureScreenTree,
  writeMigrationList,
  writeProvingRecording,
  writeUnstableScreen,
} from '../test-fixtures/check-map.js';

describe('CheckMapUseCase map rules', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-checkmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('passes on the clean tree and warns on a screen with no edges', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(report.passed).toBe(true);
    expect(failRules(report)).toEqual([]);
    expect(report.findings.some((entry) => entry.rule === 'MISSING_EDGE' && entry.severity === 'warn')).toBe(true);
    expect(report.screens[0]?.stableCoveragePct).toBe(100);
  });

  it('fails MAP_MISSING when the map was never generated', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    const { report } = checkMap(projectRoot);
    expect(report.passed).toBe(false);
    expect(failRules(report)).toContain('MAP_MISSING');
  });

  it('fails DANGLING_EDGE when an edge points at a deleted screen', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
    writeProvingRecording(projectRoot, '2026-11-13T11:00:00.000Z');
    generateMap(projectRoot);
    fs.rmSync(screenDirFor(projectRoot, 'checkout'), { recursive: true, force: true });
    const { report } = checkMap(projectRoot);
    expect(report.passed).toBe(false);
    expect(failRules(report)).toContain('DANGLING_EDGE');
  });

  it('fails STALE_EDGE when a to screen was re-learned since the recording', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
    writeProvingRecording(projectRoot, '2026-11-13T09:00:00.000Z');
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(report.passed).toBe(false);
    expect(failRules(report)).toContain('STALE_EDGE');
  });
});

describe('CheckMapUseCase screen rules', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-checkmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fails SPLIT_MERGE_NO_MIGRATION when a split has no migration list', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeElementsBackup(projectRoot, 'login', 'login.promo-banner');
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(report.passed).toBe(false);
    expect(failRules(report)).toContain('SPLIT_MERGE_NO_MIGRATION');
    expect(report.findings.find((entry) => entry.rule === 'SPLIT_MERGE_NO_MIGRATION')?.message).toContain('login.promo-banner');
  });

  it('passes the split check when a migration list removes the lost id', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeElementsBackup(projectRoot, 'login', 'login.promo-banner');
    writeMigrationList(projectRoot, 'login', 'login.promo-banner');
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).not.toContain('SPLIT_MERGE_NO_MIGRATION');
  });

  it('fails SCOPE_BELOW_80 when over 20% of elements lack a stable anchor', () => {
    writeUnstableScreen(projectRoot);
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(report.passed).toBe(false);
    expect(failRules(report)).toContain('SCOPE_BELOW_80');
  });
});
