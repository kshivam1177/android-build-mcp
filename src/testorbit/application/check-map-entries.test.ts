/**
 * `check-screen-map` tests, part 2 (Phase 6, C3/C16) — map-entry,
 * variant-file, and migration-list rules, each failing with the exact
 * rule named. Fixtures only.
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
  writeElevenVariants,
  writeElementsBackup,
  writeFixtureScreenTree,
  writeMigrationMapping,
  writeVariantFile,
} from '../test-fixtures/check-map.js';

describe('CheckMapUseCase map-entry rules', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-checkmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fails SCREEN_WITHOUT_MAP_ENTRY when a screen is learned after the map', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    generateMap(projectRoot);
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('SCREEN_WITHOUT_MAP_ENTRY');
  });

  it('fails MAP_ENTRY_UNKNOWN_SCREEN when the map lists a ghost screen', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    generateMap(projectRoot);
    const mapPath = path.join(projectRoot, '.testorbit', 'android', 'screen-map.json');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as { screens: Record<string, unknown>[] };
    map.screens.push({ screenId: 'ghost', variants: [], elementCount: 0 });
    fs.writeFileSync(mapPath, JSON.stringify(map), 'utf8');
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('MAP_ENTRY_UNKNOWN_SCREEN');
  });

  it('fails MAP_INVALID when the map is not valid JSON', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    generateMap(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, '.testorbit', 'android', 'screen-map.json'),
      '{bad',
      'utf8',
    );
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('MAP_INVALID');
  });

  it('fails VARIANT_FILE_INVALID when a variant file is not valid JSON', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    generateMap(projectRoot);
    fs.writeFileSync(
      path.join(screenDirFor(projectRoot, 'login'), 'variants', 'login.password.json'),
      '{bad',
      'utf8',
    );
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('VARIANT_FILE_INVALID');
  });
});

describe('CheckMapUseCase variant and migration rules', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-checkmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fails VARIANT_REFERENCES_UNKNOWN_ELEMENT when a variant names a missing id', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeVariantFile(projectRoot, 'login', 'login.ghost-ref', ['login.no-such-element'], []);
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('VARIANT_REFERENCES_UNKNOWN_ELEMENT');
  });

  it('fails VALUE_CHANGE_DUPLICATE when two variants share one component set', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeVariantFile(projectRoot, 'login', 'login.dup-a', ['login.back'], []);
    writeVariantFile(projectRoot, 'login', 'login.dup-b', ['login.back'], []);
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('VALUE_CHANGE_DUPLICATE');
  });

  it('fails INVALID_SCREEN_ID when a screen folder name is not a valid id', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    fs.mkdirSync(path.join(projectRoot, '.testorbit', 'android', 'screens', 'bad id!'), { recursive: true });
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('INVALID_SCREEN_ID');
  });
});

describe('CheckMapUseCase migration rules', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-checkmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fails MIGRATION_INVALID when a mapping points at a missing target', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeElementsBackup(projectRoot, 'login', 'login.promo-banner');
    writeMigrationMapping(projectRoot, 'login', [['login.promo-banner', 'login.missing-target']], []);
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('MIGRATION_INVALID');
    expect(failRules(report)).not.toContain('SPLIT_MERGE_NO_MIGRATION');
  });

  it('warns MIGRATION_BASELINE_UNREADABLE when the .bak cannot be parsed', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    fs.writeFileSync(
      path.join(screenDirFor(projectRoot, 'login'), 'elements.json.bak'),
      '{bad',
      'utf8',
    );
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(report.passed).toBe(true);
    expect(report.findings.some((entry) => entry.rule === 'MIGRATION_BASELINE_UNREADABLE')).toBe(true);
  });
});

describe('CheckMapUseCase file rules', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-checkmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fails ELEMENT_ID_DUPLICATE when elements.json lists one id twice', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    const elementsPath = path.join(screenDirFor(projectRoot, 'login'), 'elements.json');
    const elements = JSON.parse(fs.readFileSync(elementsPath, 'utf8')) as Record<string, unknown>[];
    fs.writeFileSync(elementsPath, JSON.stringify([...elements, elements[0]], null, 2), 'utf8');
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('ELEMENT_ID_DUPLICATE');
  });

  it('fails FINGERPRINT_STAMP_MISMATCH when a variant file is tampered with', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    const variantPath = path.join(screenDirFor(projectRoot, 'login'), 'variants', 'login.password.json');
    const variant = JSON.parse(fs.readFileSync(variantPath, 'utf8')) as Record<string, unknown>;
    variant['required'] = ['login.help'];
    fs.writeFileSync(variantPath, JSON.stringify(variant, null, 2), 'utf8');
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('FINGERPRINT_STAMP_MISMATCH');
  });

  it('fails VARIANT_COUNT_EXCEEDED above 10 variants on one screen', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeElevenVariants(projectRoot);
    generateMap(projectRoot);
    const { report } = checkMap(projectRoot);
    expect(failRules(report)).toContain('VARIANT_COUNT_EXCEEDED');
  });
});
