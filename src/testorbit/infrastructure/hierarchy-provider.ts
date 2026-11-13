/**
 * Hierarchy providers (Part D, D1) — adapters behind one interface.
 *
 * The TestOrbit Runner and `orbit_detect_variant` need a fresh hierarchy dump on
 * any platform; each provider converts its platform's tree into the same
 * `CoreHierarchyNode` shape the matcher consumes. Providers never depend
 * on each other and never touch the cross-platform engine in
 * `src/platform/` — the Android provider below wraps a caller-supplied
 * dump function, and the iOS provider talks to WebDriverAgent directly.
 */
import fs from 'node:fs';
import { z } from 'zod';
import { parseUiHierarchy } from '../../automation/uiHierarchy.js';
import { TestOrbitError } from '../domain/errors.js';
import type { CoreHierarchyNode } from '../domain/types.js';
import type { DisplaySize } from '../core/screen-identity.js';
import type { UiNode } from '../../types.js';

/** One hierarchy source behind the interface every consumer uses. */
export interface HierarchyProvider {
  /** Dump the live hierarchy as core nodes, in document order. */
  dumpHierarchy(): Promise<readonly CoreHierarchyNode[]>;
  /** Visible display size for the B6 present rule. */
  displaySize(): Promise<DisplaySize>;
}

/** A hierarchy dump file: nodes plus the display they were captured on. */
export const HierarchyDumpSchema = z
  .object({
    nodes: z.array(
      z
        .object({
          ref: z.string().min(1),
          resourceId: z.string().optional(),
          contentDesc: z.string().optional(),
          className: z.string().optional(),
          text: z.string().optional(),
          packageName: z.string().optional(),
          bounds: z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }).strict(),
          clickable: z.boolean(),
          enabled: z.boolean(),
          focusable: z.boolean().optional(),
          checkable: z.boolean().optional(),
          parentRef: z.string().optional(),
          ancestorChain: z.array(z.string()).optional(),
        })
        .strict(),
    ),
    display: z.object({ width: z.number(), height: z.number() }).strict(),
  })
  .strict();

export type HierarchyDump = z.infer<typeof HierarchyDumpSchema>;

/**
 * Convert a parsed hierarchy dump into core nodes. The dump schema's
 * optional fields carry explicit `undefined` under the testorbit tsconfig,
 * so the conversion assigns each optional field only when present.
 *
 * @param dump - Validated hierarchy dump.
 * @returns Core nodes in document order.
 */
export function dumpNodesToCore(dump: HierarchyDump): CoreHierarchyNode[] {
  return dump.nodes.map((node) => {
    const core: CoreHierarchyNode = {
      ref: node.ref,
      bounds: node.bounds,
      clickable: node.clickable,
      enabled: node.enabled,
    };
    if (node.resourceId !== undefined) core.resourceId = node.resourceId;
    if (node.contentDesc !== undefined) core.contentDesc = node.contentDesc;
    if (node.className !== undefined) core.className = node.className;
    if (node.text !== undefined) core.text = node.text;
    if (node.packageName !== undefined) core.packageName = node.packageName;
    if (node.parentRef !== undefined) core.parentRef = node.parentRef;
    if (node.ancestorChain !== undefined) core.ancestorChain = node.ancestorChain;
    if (node.focusable !== undefined) core.focusable = node.focusable;
    if (node.checkable !== undefined) core.checkable = node.checkable;
    return core;
  });
}

/**
 * Parse a hierarchy dump file's contents (`{ nodes, display }`).
 *
 * @param value - Untrusted parsed JSON of the dump file.
 * @param filePath - Path used in the error when validation fails.
 * @returns The validated dump.
 * @throws TestOrbitError naming the failing field.
 */
export function parseHierarchyDump(value: unknown, filePath: string): HierarchyDump {
  const result = HierarchyDumpSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new TestOrbitError(
      'SCHEMA_VERSION',
      `Invalid hierarchy dump file ${filePath}: ${issues}`,
      'Dump the hierarchy again, or fix the named field by hand.',
      { filePath },
    );
  }
  return result.data;
}

/**
 * Read a hierarchy dump file from disk.
 *
 * @param filePath - Absolute path of the dump JSON file.
 * @returns The validated dump.
 */
export function readHierarchyDumpFile(filePath: string): HierarchyDump {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new TestOrbitError(
      'FILE_READ_FAILED',
      `Could not read hierarchy dump file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      'Check the path exists and holds valid JSON.',
      { filePath },
    );
  }
  return parseHierarchyDump(raw, filePath);
}

/** Convert a parsed `UiNode` into the core node shape (stable fields kept). */
function toCoreNode(node: UiNode): CoreHierarchyNode {
  const core: CoreHierarchyNode = {
    ref: node.ref,
    bounds: node.bounds,
    clickable: node.clickable,
    enabled: node.enabled,
  };
  if (node.resourceId !== undefined) core.resourceId = node.resourceId;
  if (node.contentDesc !== undefined) core.contentDesc = node.contentDesc;
  if (node.className !== undefined) core.className = node.className;
  if (node.text !== undefined) core.text = node.text;
  if (node.packageName !== undefined) core.packageName = node.packageName;
  if (node.parentRef !== undefined) core.parentRef = node.parentRef;
  if (node.ancestorChain !== undefined) core.ancestorChain = node.ancestorChain;
  if (node.focusable !== undefined) core.focusable = node.focusable;
  if (node.checkable !== undefined) core.checkable = node.checkable;
  return core;
}

/**
 * Android hierarchy provider: wraps a caller-supplied XML dump (the
 * backend's `dumpHierarchy`) and screen-size lookup, so the provider
 * itself holds no device handle and is unit-testable without a device.
 */
export class AndroidHierarchyProvider implements HierarchyProvider {
  /**
   * @param dumpXml - Dumps the uiautomator hierarchy XML.
   * @param getDisplay - Returns the visible display size.
   */
  constructor(
    private readonly dumpXml: () => Promise<string>,
    private readonly getDisplay: () => Promise<DisplaySize>,
  ) {}

  /**
   * Dump and parse the Android hierarchy.
   *
   * @returns Core nodes in document order, with parent refs and
   *   ancestor chains from `parseUiHierarchy`.
   */
  async dumpHierarchy(): Promise<readonly CoreHierarchyNode[]> {
    return parseUiHierarchy(await this.dumpXml()).map(toCoreNode);
  }

  /**
   * @returns The visible display size from the injected lookup.
   */
  async displaySize(): Promise<DisplaySize> {
    return this.getDisplay();
  }
}
