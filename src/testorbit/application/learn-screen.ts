/**
 * Learn-screen use case (Phase 2, B2/B7) — learns one variant of a
 * screen from a hierarchy dump.
 *
 * The caller drives the app into the variant's state and passes the
 * fresh dump plus the designated required subset (the elements that
 * define the variant; for the `default` variant, the designated subset
 * of the base screen's shared elements). Element ids come from the one
 * shared derivation (B3); selectors live in the base `elements.json`
 * only — variant files reference ids, never redefine selectors.
 *
 * Excluded derivation (B7) reads the screen's other variant files
 * directly — never `screen-map.json`, which is only generated in
 * Phase 6. The first variant's excluded starts empty and is backfilled
 * when a later variant is learned.
 *
 * Value-change rule (mechanical, B7): learning a variant whose
 * required+excluded sets AND relaxed fingerprint are identical to an
 * existing variant is rejected — "same component set, different values
 * — not a new variant". Guardrail: flag >5 variants per screen, fail
 * >10. Re-learning an existing variant id keeps a `.bak` backup.
 *
 * Safe re-learn (Phase 3): `elements.json` is also written with a
 * `.bak` backup, and re-learning refreshes the stored selector and
 * state of ids already known (the fresh dump is the truth for those
 * attributes). Ids absent from the fresh dump are kept — other
 * variants reference them in their required/excluded sets, so pruning
 * them would break variant files; removals are reported by the learn
 * diff (`core/screen-diff.ts`), not by deleting base elements.
 */
import path from 'node:path';
import { computeFingerprintStamp, computeVariantFingerprintStamp } from '../core/fingerprint.js';
import { deriveElementIds } from '../core/element-id.js';
import { stableSelectorOf } from '../core/matcher.js';
import { isInteractiveNode } from '../core/screen-identity.js';
import { TestOrbitError } from '../domain/errors.js';
import type { ElementId, LearnedScreenElement, Platform, ScreenId, VariantDefinition, VariantId } from '../domain/types.js';
import type { DisplaySize } from '../core/screen-identity.js';
import type { CoreHierarchyNode } from '../domain/types.js';
import type { VariantStore } from '../infrastructure/variant-store.js';
import { writeFileWithBackup } from '../infrastructure/filesystem.js';

/** Flag at >5 variants per screen, fail at >10 (B7 guardrail). */
export const VARIANT_FLAG_THRESHOLD = 5;
export const VARIANT_FAIL_THRESHOLD = 10;

/** Inputs to learning one variant. */
export interface LearnVariantInput {
  projectRoot: string;
  platform: Platform;
  screenId: ScreenId;
  variantId: VariantId;
  /** Fresh hierarchy dump of the screen in this variant's state. */
  nodes: readonly CoreHierarchyNode[];
  display: DisplaySize;
  /** Designated required subset; defaults to every interactive id present. */
  requiredIds?: readonly ElementId[];
  /** Optional elements present in this state. */
  optionalIds?: readonly ElementId[];
  /** Provenance, e.g. `recording: <name>.json`. */
  learnedFrom?: string;
}

/** Outcome of learning one variant. */
export interface LearnVariantResult {
  definition: VariantDefinition;
  /** Absolute path of the written variant file. */
  path: string;
  /** Backup of the previous variant file, when re-learning. */
  backupPath: string | null;
  /** Backup of the previous elements.json, when re-learning. */
  elementBackupPath: string | null;
  /** Existing variants whose excluded sets were backfilled. */
  backfilledVariants: readonly VariantId[];
  /** Guardrail warning when the screen now has >5 variants. */
  warning?: string;
}

/** Same ids, ignoring order. */
function sameIdSet(left: readonly ElementId[], right: readonly ElementId[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

/** Relaxed fingerprint of a required+excluded set (selectors only). */
function relaxedFingerprint(ids: readonly ElementId[], byId: ReadonlyMap<ElementId, LearnedScreenElement>): string {
  const selectors = ids
    .map((id) => byId.get(id)?.selector)
    .filter((selector): selector is NonNullable<typeof selector> => selector !== undefined);
  return computeFingerprintStamp(selectors);
}

/** Learned base element for one fresh node. */
function elementOf(id: ElementId, node: CoreHierarchyNode): LearnedScreenElement {
  const element: LearnedScreenElement = {
    id,
    selector: stableSelectorOf(node),
    clickable: node.clickable,
    enabled: node.enabled,
  };
  if (node.text !== undefined) {
    return { ...element, text: node.text, bounds: node.bounds };
  }
  return { ...element, bounds: node.bounds };
}

/**
 * Serialise a learned element for `elements.json`: the on-disk field is
 * `stableSelector` (as written by `orbit_learn_screen`), while the in-memory
 * type calls it `selector`.
 */
function toFileElement(element: LearnedScreenElement): Record<string, unknown> {
  const fileElement: Record<string, unknown> = {
    id: element.id,
    stableSelector: element.selector,
    clickable: element.clickable,
    enabled: element.enabled,
  };
  if (element.text !== undefined) fileElement['text'] = element.text;
  if (element.bounds !== undefined) fileElement['bounds'] = element.bounds;
  return fileElement;
}

/** Learn one variant of a screen from a hierarchy dump. */
export class LearnScreenUseCase {
  /**
   * @param store - Variant store for the target platform folder.
   */
  constructor(private readonly store: VariantStore) {}

  /**
   * Learn (or re-learn) a variant.
   *
   * @param input - Screen, variant, fresh dump, designated required set.
   * @returns The written definition, its path, backup, and backfills.
   * @throws TestOrbitError on an empty required set, a designated required
   *   element that is not present, a value-change duplicate, or >10
   *   variants on the screen.
   */
  learnVariant(input: LearnVariantInput): LearnVariantResult {
    const interactive = input.nodes.filter(isInteractiveNode);
    const ids = deriveElementIds(interactive, input.screenId, input.nodes);
    const presentIds = new Set(interactive.map((node) => ids.get(node.ref) as ElementId));
    const required = input.requiredIds ?? [...presentIds];
    const optional = input.optionalIds ?? [];
    this.validateDesignated(required, optional, presentIds);
    const existing = this.store.loadScreen(input.screenId);
    const merged = this.mergeBaseElements(existing?.baseElements ?? [], interactive, ids);
    const byId = new Map(merged.map((element) => [element.id, element]));
    const others = (existing?.variants ?? []).filter((variant) => variant.variantId !== input.variantId);
    const excluded = this.deriveExcluded(others, presentIds);
    this.rejectValueChange(others, required, excluded, byId);
    const count = others.length + 1;
    if (count > VARIANT_FAIL_THRESHOLD) {
      throw new TestOrbitError(
        'VARIANT_COUNT_EXCEEDED',
        `Screen "${input.screenId}" already has ${others.length} variants; learning another would exceed ${VARIANT_FAIL_THRESHOLD}.`,
        'Split the screen into two logical screens, or remove a variant that is no longer real.',
        { screenId: input.screenId, variantId: input.variantId, count: String(count) },
      );
    }
    const definition = this.buildDefinition(input, required, optional, excluded);
    const screenDir = this.store.screenDir(input.screenId);
    const elementBackupPath = writeFileWithBackup(
      path.join(screenDir, 'elements.json'),
      `${JSON.stringify(merged.map(toFileElement), null, 2)}\n`,
    );
    const variantPath = path.join(screenDir, 'variants', `${input.variantId}.json`);
    const backupPath = writeFileWithBackup(variantPath, `${JSON.stringify(definition, null, 2)}\n`);
    const backfilled = this.backfillExcluded(others, definition, screenDir);
    const result: LearnVariantResult = {
      definition,
      path: variantPath,
      backupPath,
      elementBackupPath,
      backfilledVariants: backfilled,
    };
    if (count > VARIANT_FLAG_THRESHOLD) {
      return {
        ...result,
        warning: `Screen "${input.screenId}" now has ${count} variants (flag threshold ${VARIANT_FLAG_THRESHOLD}); consider splitting it.`,
      };
    }
    return result;
  }

  /** Designated required/optional ids must be non-empty and present now. */
  private validateDesignated(
    required: readonly ElementId[],
    optional: readonly ElementId[],
    presentIds: ReadonlySet<ElementId>,
  ): void {
    if (required.length === 0) {
      throw new TestOrbitError(
        'INVALID_VARIANT',
        'A variant must designate at least one required element: an empty required set would match everything.',
        'Pass the elements that define this variant as requiredIds.',
        {},
      );
    }
    for (const id of [...required, ...optional]) {
      if (!presentIds.has(id)) {
        throw new TestOrbitError(
          'ELEMENT_NOT_FOUND',
          `Designated element "${id}" is not present in the fresh hierarchy dump.`,
          'Drive the app into the variant state first, or drop the element from the designated set.',
          { elementId: id },
        );
      }
    }
  }

  /**
   * Merge freshly learned elements into the base set, by id. A fresh
   * node refreshes the stored selector and state of an id already
   * known; ids absent from the fresh dump are kept (other variants
   * reference them), so the base set is the union of everything ever
   * learned for the screen.
   */
  private mergeBaseElements(
    existing: readonly LearnedScreenElement[],
    interactive: readonly CoreHierarchyNode[],
    ids: ReadonlyMap<string, ElementId>,
  ): LearnedScreenElement[] {
    const merged = new Map(existing.map((element) => [element.id, element]));
    for (const node of interactive) {
      const id = ids.get(node.ref) as ElementId;
      merged.set(id, elementOf(id, node));
    }
    return [...merged.values()];
  }

  /** Excluded = other variants' elements minus elements present now (B7). */
  private deriveExcluded(
    others: readonly VariantDefinition[],
    presentIds: ReadonlySet<ElementId>,
  ): ElementId[] {
    const universe = new Set<ElementId>();
    for (const variant of others) {
      for (const id of [...variant.required, ...variant.optional, ...variant.excluded]) universe.add(id);
    }
    return [...universe].filter((id) => !presentIds.has(id)).sort();
  }

  /** Reject a variant that differs from an existing one in values only. */
  private rejectValueChange(
    others: readonly VariantDefinition[],
    required: readonly ElementId[],
    excluded: readonly ElementId[],
    byId: ReadonlyMap<ElementId, LearnedScreenElement>,
  ): void {
    for (const variant of others) {
      if (!sameIdSet(variant.required, required)) continue;
      if (!sameIdSet(variant.excluded, excluded)) continue;
      const existingStamp = relaxedFingerprint([...variant.required, ...variant.excluded], byId);
      const newStamp = relaxedFingerprint([...required, ...excluded], byId);
      if (existingStamp !== newStamp) continue;
      throw new TestOrbitError(
        'VARIANT_VALUE_CHANGE',
        `Variant "${variant.variantId}" of this screen already has the same component set (same required+excluded elements): same component set, different values — not a new variant.`,
        'A different price, count, or timestamp is the same variant. Learn a new variant only when the component set changes.',
        { screenId: variant.screenId, variantId: variant.variantId },
      );
    }
  }

  /** Build the variant definition with its fingerprint stamp (B2). */
  private buildDefinition(
    input: LearnVariantInput,
    required: readonly ElementId[],
    optional: readonly ElementId[],
    excluded: readonly ElementId[],
  ): VariantDefinition {
    const definition: VariantDefinition = {
      schemaVersion: 2,
      screenId: input.screenId,
      variantId: input.variantId,
      required: [...required].sort(),
      optional: [...optional].sort(),
      excluded: [...excluded].sort(),
      fingerprintStamp: computeVariantFingerprintStamp({
        screenId: input.screenId,
        variantId: input.variantId,
        required,
        optional,
        excluded,
      }),
      learnedAt: new Date().toISOString(),
    };
    if (input.learnedFrom !== undefined) return { ...definition, learnedFrom: input.learnedFrom };
    return definition;
  }

  /**
   * Backfill existing variants' excluded sets with the new variant's
   * elements (B7): each gains the new required/optional ids that are
   * not its own, with a fresh stamp. Returns the backfilled variant ids.
   */
  private backfillExcluded(
    others: readonly VariantDefinition[],
    definition: VariantDefinition,
    screenDir: string,
  ): VariantId[] {
    const backfilled: VariantId[] = [];
    const gained = new Set([...definition.required, ...definition.optional]);
    for (const variant of others) {
      const own = new Set([...variant.required, ...variant.optional]);
      const additions = [...gained].filter((id) => !own.has(id) && !variant.excluded.includes(id));
      if (additions.length === 0) continue;
      const excluded = [...variant.excluded, ...additions].sort();
      const updated: VariantDefinition = {
        ...variant,
        excluded,
        fingerprintStamp: computeVariantFingerprintStamp({
          screenId: variant.screenId,
          variantId: variant.variantId,
          required: variant.required,
          optional: variant.optional,
          excluded,
        }),
      };
      writeFileWithBackup(
        path.join(screenDir, 'variants', `${variant.variantId}.json`),
        `${JSON.stringify(updated, null, 2)}\n`,
      );
      backfilled.push(variant.variantId);
    }
    return backfilled;
  }
}
