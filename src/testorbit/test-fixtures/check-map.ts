/**
 * Shared fixtures for `check-screen-map` tests (Phase 6, C3/C16).
 *
 * Fixture screens/recordings/migration lists for unit-testing the
 * checker ONLY — never flows, never shipped as example tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CheckMapUseCase } from '../application/check-map.js';
import { GenerateMapUseCase } from '../application/generate-map.js';
import { computeVariantFingerprintStamp } from '../core/fingerprint.js';
import { toElementId } from '../domain/types.js';
import { writeFixtureScreenTree } from './variants.js';

/** Rules of the fail findings in a report. */
export function failRules(report: { findings: readonly { rule: string; severity: string }[] }): string[] {
  return report.findings.filter((entry) => entry.severity === 'fail').map((entry) => entry.rule);
}

/** Write the proving recording used by the generate-map fixture. */
export function writeProvingRecording(projectRoot: string, stoppedAt: string): void {
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
        { id: 'tap-1', type: 'tap', timestamp: '2026-11-13T10:30:00.000Z', durationMs: 100, selector: { resourceId: 'com.shop.app:id/submit' }, screenId: 'login', variantId: 'login.password', elementId: 'login.submit', isNavigationStep: false },
        { id: 'tap-2', type: 'tap', timestamp: '2026-11-13T10:30:01.000Z', durationMs: 100, selector: { resourceId: 'com.shop.app:id/cod_option' }, screenId: 'checkout', variantId: 'checkout.method-picker', elementId: 'checkout.cod-option', isNavigationStep: true },
      ],
      screenshots: {},
    }),
    'utf8',
  );
}

/** Generate the map for the fixture tree. */
export function generateMap(projectRoot: string): void {
  new GenerateMapUseCase().generate({ projectRoot, platform: 'android' });
}

/** Run the checker on the fixture tree. */
export function checkMap(projectRoot: string): ReturnType<CheckMapUseCase['check']> {
  return new CheckMapUseCase().check({ projectRoot, platform: 'android' });
}

/** Absolute path of one screen's folder in the fixture tree. */
export function screenDirFor(projectRoot: string, screenId: string): string {
  return path.join(projectRoot, '.testorbit', 'android', 'screens', screenId);
}

/** Write a previous-learn backup with one extra element id. */
export function writeElementsBackup(projectRoot: string, screenId: string, extraId: string): void {
  const elementsPath = path.join(screenDirFor(projectRoot, screenId), 'elements.json');
  const elements = JSON.parse(fs.readFileSync(elementsPath, 'utf8')) as Record<string, unknown>[];
  const extra = { ...elements[0], id: extraId, stableSelector: { resourceId: 'com.shop.app:id/promo_banner' } };
  fs.writeFileSync(
    `${elementsPath}.bak`,
    JSON.stringify([...elements, extra], null, 2),
    'utf8',
  );
}

/** Write a migration list covering one removed id. */
export function writeMigrationList(projectRoot: string, screenId: string, removedId: string): void {
  writeMigrationMapping(projectRoot, screenId, [], [removedId]);
}

/** Write a migration list with explicit mappings and removals. */
export function writeMigrationMapping(
  projectRoot: string,
  screenId: string,
  mappings: [string, string][],
  removed: string[],
): void {
  const migrationsDir = path.join(screenDirFor(projectRoot, screenId), 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(
    path.join(migrationsDir, 'split-2026-11-13.json'),
    JSON.stringify({
      schemaVersion: 2,
      migration: 'split-2026-11-13',
      reason: 'Split fixture.',
      fromScreen: screenId,
      toScreens: [screenId],
      mappings: mappings.map(([from, to]) => ({ from, to })),
      removed,
      createdAt: '2026-11-13T10:00:00Z',
    }),
    'utf8',
  );
}

/** Write a screen whose elements carry no resourceId or contentDesc. */
export function writeUnstableScreen(projectRoot: string): void {
  const dir = path.join(screenDirFor(projectRoot, 'plain'), 'variants');
  fs.mkdirSync(dir, { recursive: true });
  const elements = ['plain.a', 'plain.b', 'plain.c', 'plain.d', 'plain.e'].map((id) => ({
    id,
    stableSelector: { className: 'android.widget.Button' },
    clickable: true,
    enabled: true,
  }));
  fs.writeFileSync(path.join(screenDirFor(projectRoot, 'plain'), 'elements.json'), JSON.stringify(elements), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'default.json'),
    JSON.stringify({
      schemaVersion: 2,
      screenId: 'plain',
      variantId: 'default',
      required: ['plain.a'],
      optional: [],
      excluded: [],
      fingerprintStamp: computeVariantFingerprintStamp({
        screenId: 'plain',
        variantId: 'default',
        required: ['plain.a'].map(toElementId),
        optional: [],
        excluded: [],
      }),
      learnedAt: '2026-11-13T10:00:00Z',
    }),
    'utf8',
  );
}

/** Add eleven distinct variants to the login screen (fail threshold is 10). */
export function writeElevenVariants(projectRoot: string): void {
  const variantsDir = path.join(screenDirFor(projectRoot, 'login'), 'variants');
  const ids = ['login.help', 'login.back', 'login.username', 'login.password', 'login.submit', 'login.otp-field', 'login.verify-otp', 'login.sso-google', 'login.sso-apple'];
  for (let i = 0; i < 11; i += 1) {
    const required = i < 9 ? [ids[i] as string] : [ids[0] as string, ids[i - 8] as string];
    const requiredIds = required.map(toElementId);
    const variantId = `login.extra-${i}`;
    fs.writeFileSync(
      path.join(variantsDir, `${variantId}.json`),
      JSON.stringify({
        schemaVersion: 2,
        screenId: 'login',
        variantId,
        required,
        optional: [],
        excluded: [],
        fingerprintStamp: computeVariantFingerprintStamp({
          screenId: 'login',
          variantId,
          required: requiredIds,
          optional: [],
          excluded: [],
        }),
        learnedAt: '2026-11-13T10:00:00Z',
      }),
      'utf8',
    );
  }
}

/** Write one variant file with a valid stamp. */
export function writeVariantFile(
  projectRoot: string,
  screenId: string,
  variantId: string,
  required: string[],
  excluded: string[],
): void {
  const requiredIds = required.map(toElementId);
  const excludedIds = excluded.map(toElementId);
  fs.writeFileSync(
    path.join(screenDirFor(projectRoot, screenId), 'variants', `${variantId}.json`),
    JSON.stringify({
      schemaVersion: 2,
      screenId,
      variantId,
      required,
      optional: [],
      excluded,
      fingerprintStamp: computeVariantFingerprintStamp({
        screenId,
        variantId,
        required: requiredIds,
        optional: [],
        excluded: excludedIds,
      }),
      learnedAt: '2026-11-13T10:00:00Z',
    }),
    'utf8',
  );
}

export { writeFixtureScreenTree };
