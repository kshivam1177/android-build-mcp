import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LearnScreenUseCase } from './learn-screen.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import { parseVariantDefinition } from '../domain/schemas.js';
import { computeVariantFingerprintStamp } from '../core/fingerprint.js';
import { DISPLAY, freshCheckoutCard, freshCheckoutPicker, freshLoginPassword } from '../test-fixtures/variants.js';
import { toElementId, toScreenId, toVariantId } from '../domain/types.js';
import type { CoreHierarchyNode } from '../domain/types.js';

/** Temp project with a fresh LearnScreenUseCase. */
function makeUseCase(): { projectRoot: string; useCase: LearnScreenUseCase; store: VariantStore } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-learn-'));
  const store = new VariantStore(projectRoot, 'android');
  return { projectRoot, useCase: new LearnScreenUseCase(store), store };
}

/** Synthetic nodes with distinct resourceIds, for guardrail tests. */
function syntheticNodes(ids: readonly string[]): CoreHierarchyNode[] {
  return ids.map((id, index) => ({
    ref: `e${index + 1}`,
    resourceId: `com.example.app:id/${id.replace(/^screen\./, '').replace(/-/g, '_')}`,
    bounds: { left: 10, top: 20 + index * 60, right: 110, bottom: 70 + index * 60 },
    clickable: true,
    enabled: true,
  }));
}

const CARD_REQUIRED = ['checkout.card-number', 'checkout.expiry', 'checkout.cvv', 'checkout.pay'].map(toElementId);

/** Learn the card variant once (shared setup for the learn tests). */
function learnCard(useCase: LearnScreenUseCase, projectRoot: string) {
  return useCase.learnVariant({
    projectRoot,
    platform: 'android',
    screenId: toScreenId('checkout'),
    variantId: toVariantId('checkout.online-card'),
    nodes: freshCheckoutCard(),
    display: DISPLAY,
    requiredIds: CARD_REQUIRED,
    optionalIds: ['checkout.save-card'].map(toElementId),
    learnedFrom: 'recording: checkout-card.json',
  });
}

/** Re-learn the card variant, optionally with a different fresh dump. */
function relearnCard(
  useCase: LearnScreenUseCase,
  projectRoot: string,
  nodes: readonly CoreHierarchyNode[] = freshCheckoutCard(),
) {
  return useCase.learnVariant({
    projectRoot,
    platform: 'android',
    screenId: toScreenId('checkout'),
    variantId: toVariantId('checkout.online-card'),
    nodes,
    display: DISPLAY,
    requiredIds: CARD_REQUIRED,
    optionalIds: ['checkout.save-card'].map(toElementId),
  });
}

function readVariant(projectRoot: string, screenId: string, variantId: string): Record<string, unknown> {
  const filePath = path.join(projectRoot, '.testorbit', 'android', 'screens', screenId, 'variants', `${variantId}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

/** Read a learned screen's elements.json as id-keyed records. */
function readElements(projectRoot: string, screenId: string): Array<Record<string, unknown>> {
  const filePath = path.join(projectRoot, '.testorbit', 'android', 'screens', screenId, 'elements.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Array<Record<string, unknown>>;
}

/** Learn one synthetic variant (`screen.v<n>`, required `screen.el-<n>`). */
function learnSynthetic(useCase: LearnScreenUseCase, projectRoot: string, ids: readonly string[], index: number) {
  return useCase.learnVariant({
    projectRoot,
    platform: 'android',
    screenId: toScreenId('screen'),
    variantId: toVariantId(`screen.v${index + 1}`),
    nodes: syntheticNodes(ids),
    display: DISPLAY,
    requiredIds: [toElementId(ids[index] as string)],
  });
}

describe('LearnScreenUseCase — first variant', () => {
  let projectRoot: string;
  let useCase: LearnScreenUseCase;

  beforeEach(() => {
    ({ projectRoot, useCase } = makeUseCase());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('learns the first variant with an empty excluded set and a valid stamp', () => {
    const result = learnCard(useCase, projectRoot);
    expect(result.definition.excluded).toEqual([]);
    expect(result.backupPath).toBeNull();
    expect(result.backfilledVariants).toEqual([]);
    const stamp = computeVariantFingerprintStamp({
      screenId: 'checkout',
      variantId: 'checkout.online-card',
      required: result.definition.required,
      optional: result.definition.optional,
      excluded: result.definition.excluded,
    });
    expect(result.definition.fingerprintStamp).toBe(stamp);
    const stored = parseVariantDefinition(readVariant(projectRoot, 'checkout', 'checkout.online-card'), 'x');
    expect(stored.required).toEqual(result.definition.required);
    const elements = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.testorbit', 'android', 'screens', 'checkout', 'elements.json'), 'utf8'),
    ) as unknown[];
    expect(elements).toHaveLength(7);
  });

  it('rejects an empty required set (default must designate elements)', () => {
    expect(() =>
      useCase.learnVariant({
        projectRoot,
        platform: 'android',
        screenId: toScreenId('checkout'),
        variantId: toVariantId('default'),
        nodes: freshCheckoutCard(),
        display: DISPLAY,
        requiredIds: [],
      }),
    ).toThrow(/at least one required element/);
  });
});

describe('LearnScreenUseCase — excluded derivation and backfill', () => {
  let projectRoot: string;
  let useCase: LearnScreenUseCase;

  beforeEach(() => {
    ({ projectRoot, useCase } = makeUseCase());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('derives excluded from the other variant and backfills it on the second learn', () => {
    learnCard(useCase, projectRoot);
    const picker = useCase.learnVariant({
      projectRoot,
      platform: 'android',
      screenId: toScreenId('checkout'),
      variantId: toVariantId('checkout.method-picker'),
      nodes: freshCheckoutPicker(),
      display: DISPLAY,
      requiredIds: ['checkout.cod-option', 'checkout.card-option', 'checkout.upi-option'].map(toElementId),
    });
    expect(picker.definition.excluded).toContain('checkout.card-number');
    expect(picker.definition.excluded).toContain('checkout.save-card');
    expect(picker.definition.excluded).not.toContain('checkout.help');
    expect(picker.backfilledVariants).toContain('checkout.online-card');
    const card = readVariant(projectRoot, 'checkout', 'checkout.online-card');
    expect(card['excluded']).toContain('checkout.cod-option');
  });

  it('keeps a backup when re-learning an existing variant', () => {
    const first = learnCard(useCase, projectRoot);
    expect(first.backupPath).toBeNull();
    const second = relearnCard(useCase, projectRoot);
    expect(second.backupPath).toBe(`${first.path}.bak`);
    expect(fs.existsSync(second.backupPath as string)).toBe(true);
  });
});

describe('LearnScreenUseCase — safe re-learn (Phase 3)', () => {
  let projectRoot: string;
  let useCase: LearnScreenUseCase;

  beforeEach(() => {
    ({ projectRoot, useCase } = makeUseCase());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('keeps a backup of elements.json when re-learning', () => {
    const first = learnCard(useCase, projectRoot);
    expect(first.elementBackupPath).toBeNull();
    const elementsPath = path.join(
      projectRoot,
      '.testorbit',
      'android',
      'screens',
      'checkout',
      'elements.json',
    );
    const before = fs.readFileSync(elementsPath, 'utf8');
    const second = relearnCard(useCase, projectRoot);
    expect(second.elementBackupPath).toBe(`${elementsPath}.bak`);
    expect(fs.readFileSync(second.elementBackupPath as string, 'utf8')).toBe(before);
  });

  it('refreshes stored element state on re-learn but keeps ids absent now', () => {
    learnCard(useCase, projectRoot);
    const disabledPay = freshCheckoutCard().map((node) =>
      node.resourceId === 'com.shop.app:id/pay' ? { ...node, enabled: false } : node,
    );
    // Drop the help element from the fresh dump: it stays in elements.json.
    const subset = disabledPay.filter((node) => node.resourceId !== 'com.shop.app:id/help');
    relearnCard(useCase, projectRoot, subset);
    const elements = readElements(projectRoot, 'checkout');
    const pay = elements.find((element) => element['id'] === 'checkout.pay') as Record<string, unknown>;
    expect(pay['enabled']).toBe(false);
    expect(elements.some((element) => element['id'] === 'checkout.help')).toBe(true);
    expect(elements).toHaveLength(7);
  });
});

describe('LearnScreenUseCase — rejections and guardrails', () => {
  let projectRoot: string;
  let useCase: LearnScreenUseCase;

  beforeEach(() => {
    ({ projectRoot, useCase } = makeUseCase());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('rejects learning a variant with the same component set and different values', () => {
    const input = {
      projectRoot,
      platform: 'android',
      screenId: toScreenId('login'),
      variantId: toVariantId('login.password'),
      nodes: freshLoginPassword(),
      display: DISPLAY,
      requiredIds: ['login.username', 'login.password', 'login.submit'].map(toElementId),
    } as const;
    useCase.learnVariant(input);
    const changedText = freshLoginPassword().map((node) =>
      node.resourceId === 'com.shop.app:id/password' ? { ...node, text: 'different-secret' } : node,
    );
    expect(() =>
      useCase.learnVariant({ ...input, variantId: toVariantId('login.password-copy'), nodes: changedText }),
    ).toThrow(/same component set, different values/);
  });

  it('flags >5 variants and fails at >10', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `screen.el-${i + 1}`);
    let warningSeen = false;
    for (let i = 0; i < 10; i += 1) {
      if (learnSynthetic(useCase, projectRoot, ids, i).warning !== undefined) warningSeen = true;
    }
    expect(warningSeen).toBe(true);
    expect(() => learnSynthetic(useCase, projectRoot, ids, 10)).toThrow(/exceed 10/);
  });
});
