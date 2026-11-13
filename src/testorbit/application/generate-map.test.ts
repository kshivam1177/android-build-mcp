/**
 * Screen-map generator tests (Phase 6, C3) — edges are derived only
 * from v2 recordings' navigation steps, v1 recordings yield no edges,
 * and an edge whose `to` screen was re-learned since its proving
 * recording is marked stale. Fixture screens/recordings only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GenerateMapUseCase } from './generate-map.js';
import { toScreenId } from '../domain/types.js';
import { writeFixtureScreenTree } from '../test-fixtures/variants.js';

/** One v2 action with screen/variant/element ids. */
function v2Action(
  id: string,
  screenId: string,
  variantId: string,
  elementId: string,
  navigation: boolean,
): Record<string, unknown> {
  return {
    id,
    type: 'tap',
    timestamp: '2026-11-13T10:30:00.000Z',
    durationMs: 100,
    selector: { resourceId: 'com.shop.app:id/submit' },
    screenId,
    variantId,
    elementId,
    isNavigationStep: navigation,
  };
}

/** Write a v2 recording proving login → checkout → checkout.cod. */
function writeProvingRecording(projectRoot: string, stoppedAt: string): void {
  const recordingsDir = path.join(projectRoot, '.testorbit', 'android', 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(recordingsDir, 'login-checkout-flow.json'),
    JSON.stringify({
      schemaVersion: 2,
      flowId: 'login-checkout-flow',
      deviceId: 'emulator-5554',
      platform: 'android',
      startedAt: '2026-11-13T10:00:00.000Z',
      stoppedAt,
      durationMs: 1000,
      actions: [
        v2Action('tap-1', 'login', 'login.password', 'login.submit', false),
        v2Action('tap-2', 'checkout', 'checkout.method-picker', 'checkout.cod-option', true),
        v2Action('tap-3', 'checkout', 'checkout.cod', 'checkout.cod-confirm', true),
      ],
      screenshots: {},
    }),
    'utf8',
  );
}

/** Write a v1 recording (no ids, no edges). */
function writeV1Recording(projectRoot: string): void {
  const recordingsDir = path.join(projectRoot, '.testorbit', 'android', 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(recordingsDir, 'old-flow.json'),
    JSON.stringify({
      schemaVersion: 1,
      flowId: 'old-flow',
      deviceId: 'emulator-5554',
      startedAt: '2026-11-13T09:00:00.000Z',
      stoppedAt: '2026-11-13T09:01:00.000Z',
      durationMs: 1000,
      actions: [
        { id: 'tap-1', type: 'tap', timestamp: '2026-11-13T09:00:01.000Z', durationMs: 100, selector: { resourceId: 'com.shop.app:id/submit' } },
      ],
      screenshots: {},
    }),
    'utf8',
  );
}

/** Build the fixture tree: login + checkout screens, one proving recording. */
function buildFixture(projectRoot: string, stoppedAt: string): void {
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
  writeProvingRecording(projectRoot, stoppedAt);
}

/** Assert the login → checkout edges of a generated map. */
function expectLoginCheckoutEdges(result: ReturnType<GenerateMapUseCase['generate']>): void {
  expect(result.map.schemaVersion).toBe(2);
  expect(result.map.screens.map((screen) => screen.screenId)).toEqual(['checkout', 'login']);
  expect(result.map.edges).toHaveLength(2);
  const first = result.map.edges.find((edge) => edge.fromScreen === 'login');
  expect(first?.toScreen).toBe('checkout');
  expect(first?.toVariant).toBe('checkout.method-picker');
  expect(first?.elementId).toBe('login.submit');
  expect(first?.recordings).toEqual(['login-checkout-flow']);
  expect(first?.stale).toBe(false);
  expect(result.map.coverage.screensLearned).toBe(2);
  expect(result.map.coverage.edgeCount).toBe(2);
  expect(fs.existsSync(result.mapPath)).toBe(true);
}

describe('GenerateMapUseCase edges', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-genmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('derives edges from navigation steps and writes a valid map', () => {
    buildFixture(projectRoot, '2026-11-13T11:00:00.000Z');
    expectLoginCheckoutEdges(new GenerateMapUseCase().generate({ projectRoot, platform: 'android' }));
  });

  it('marks an edge stale when the to screen was learned after the recording', () => {
    buildFixture(projectRoot, '2026-11-13T09:00:00.000Z');
    const result = new GenerateMapUseCase().generate({ projectRoot, platform: 'android' });
    expect(result.map.edges.every((edge) => edge.stale)).toBe(true);
    expect(result.map.edges[0]?.staleReason).toContain('re-learned');
  });

  it('marks an edge stale when elements.json is re-written after the recording', () => {
    buildFixture(projectRoot, '2026-11-13T11:00:00.000Z');
    const elementsPath = path.join(
      projectRoot,
      '.testorbit',
      'android',
      'screens',
      'checkout',
      'elements.json',
    );
    const afterRecording = new Date('2026-11-13T12:00:00.000Z');
    fs.utimesSync(elementsPath, afterRecording, afterRecording);
    const result = new GenerateMapUseCase().generate({ projectRoot, platform: 'android' });
    const toCheckout = result.map.edges.filter((edge) => edge.toScreen === 'checkout');
    expect(toCheckout.every((edge) => edge.stale)).toBe(true);
  });
});

describe('GenerateMapUseCase coverage', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-genmap-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('derives no edges from v1 recordings and warns about them', () => {
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    writeV1Recording(projectRoot);
    const result = new GenerateMapUseCase().generate({ projectRoot, platform: 'android' });
    expect(result.map.edges).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes('old-flow'))).toBe(true);
    expect(result.map.coverage.screensNeverTraversed).toEqual(['login']);
  });

  it('lists variants never traversed in coverage', () => {
    buildFixture(projectRoot, '2026-11-13T11:00:00.000Z');
    const result = new GenerateMapUseCase().generate({ projectRoot, platform: 'android' });
    expect(result.map.coverage.variantsNeverTraversed).toContain('login.otp');
    expect(result.map.coverage.variantsNeverTraversed).not.toContain('login.password');
  });
});
