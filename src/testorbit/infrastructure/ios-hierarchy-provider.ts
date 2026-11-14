/**
 * iOS hierarchy provider (Phase 2) — reads the iOS tree from
 * WebDriverAgent's `/source` JSON directly.
 *
 * This is a SEPARATE TestOrbit-side provider that BYPASSES the existing
 * Appium driver (`src/platform/ios/appiumXCUITestDriver.ts`, which
 * regex-parses the XML source into snapshots). It does not modify the
 * cross-platform engine, so the engine's existing consumers are
 * unaffected. No Appium server is run — Maestro already drives
 * WebDriverAgent itself.
 *
 * WDA `/source?format=json` returns `{ value: <root> }` where each
 * element carries `type` (e.g. `XCUIElementTypeButton`), `name` (the
 * accessibility identifier), `label`, `value`, `enabled`, `visible`,
 * `accessible`, a `rect` `{ x, y, width, height }`, and `children`.
 * The provider maps that to the same `CoreHierarchyNode` shape the
 * matcher consumes: `name` → `resourceId`, `label` → `contentDesc`,
 * `type` → `className`. An element with `visible: false` is given
 * zero-area bounds, so the B6 present rule counts it absent.
 *
 * Live check pending: no WDA on this VM (`http://127.0.0.1:8100` is
 * unreachable) — the provider is proved against fixture JSON below
 * and must be checked live on a Mac + device/simulator.
 */
import { TestOrbitError } from '../domain/errors.js';
import type { CoreHierarchyNode, NodeBounds } from '../domain/types.js';
import type { DisplaySize } from '../core/screen-identity.js';
import type { HierarchyProvider } from './hierarchy-provider.js';

/** One element of a WebDriverAgent `/source` JSON tree. */
export interface WdaSourceElement {
  type?: string;
  name?: string;
  label?: string;
  value?: string | number | boolean;
  enabled?: boolean;
  visible?: boolean;
  accessible?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  children?: WdaSourceElement[];
}

/** WDA element types that can be tapped / typed into. */
const INTERACTIVE_WDA_TYPES: ReadonlySet<string> = new Set([
  'XCUIElementTypeButton',
  'XCUIElementTypeCell',
  'XCUIElementTypeLink',
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeSearchField',
  'XCUIElementTypeSwitch',
  'XCUIElementTypeSlider',
  'XCUIElementTypePickerWheel',
  'XCUIElementTypeSegmentedControl',
  'XCUIElementTypeTabBarItem',
]);

/** WDA element types that accept text input. */
const TEXT_FIELD_WDA_TYPES: ReadonlySet<string> = new Set([
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeSearchField',
]);

/** Whether a value is a plain record (never `any`, never a bare cast). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a string field of a WDA element, when present and non-empty. */
function stringField(element: Record<string, unknown>, field: string): string | undefined {
  const value = element[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Read a boolean field of a WDA element, when present. */
function booleanField(element: Record<string, unknown>, field: string): boolean | undefined {
  const value = element[field];
  return typeof value === 'boolean' ? value : undefined;
}

/** Bounds from a WDA `rect`, or zero-area when the element has no rect. */
function boundsOf(element: Record<string, unknown>, visible: boolean): NodeBounds {
  const rect = element['rect'];
  if (!isRecord(rect)) return { left: 0, top: 0, right: 0, bottom: 0 };
  const x = typeof rect['x'] === 'number' ? rect['x'] : 0;
  const y = typeof rect['y'] === 'number' ? rect['y'] : 0;
  const width = typeof rect['width'] === 'number' ? rect['width'] : 0;
  const height = typeof rect['height'] === 'number' ? rect['height'] : 0;
  if (!visible) return { left: x, top: y, right: x, bottom: y };
  return { left: x, top: y, right: x + width, bottom: y + height };
}

/** Convert one WDA element (and its subtree) into core nodes, pre-order. */
function convertElement(
  element: Record<string, unknown>,
  out: CoreHierarchyNode[],
  parentRef: string | undefined,
  ancestorChain: readonly string[],
): void {
  const ref = `w${out.length + 1}`;
  const type = stringField(element, 'type');
  const visible = booleanField(element, 'visible') ?? true;
  const node: CoreHierarchyNode = {
    ref,
    bounds: boundsOf(element, visible),
    clickable: type !== undefined && INTERACTIVE_WDA_TYPES.has(type),
    enabled: booleanField(element, 'enabled') ?? true,
  };
  const name = stringField(element, 'name');
  if (name !== undefined) node.resourceId = name;
  const label = stringField(element, 'label');
  if (label !== undefined) node.contentDesc = label;
  if (type !== undefined) node.className = type;
  const value = element['value'];
  const text = typeof value === 'string' ? value : label;
  if (text !== undefined) node.text = text;
  if (parentRef !== undefined) node.parentRef = parentRef;
  node.ancestorChain = ancestorChain;
  if (type !== undefined && TEXT_FIELD_WDA_TYPES.has(type)) node.focusable = true;
  if (type === 'XCUIElementTypeSwitch') node.checkable = true;
  out.push(node);
  const children = element['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      if (isRecord(child)) convertElement(child, out, ref, [...ancestorChain, ref]);
    }
  }
}

/**
 * Parse a WebDriverAgent `/source` payload into core hierarchy nodes.
 *
 * @param payload - Parsed JSON of the WDA response (`{ value: <root> }`
 *   or the bare root element).
 * @returns Core nodes in document order, with parent refs and ancestor
 *   chains.
 * @throws TestOrbitError when the payload has no recognisable root element.
 */
export function parseWdaSource(payload: unknown): CoreHierarchyNode[] {
  const root = isRecord(payload) && 'value' in payload ? payload['value'] : payload;
  if (!isRecord(root)) {
    throw new TestOrbitError(
      'WDA_SOURCE_INVALID',
      'WebDriverAgent /source returned no element tree: expected { value: <root> } or a bare root element.',
      'Check that WebDriverAgent is running and /source?format=json returns JSON.',
      {},
    );
  }
  const nodes: CoreHierarchyNode[] = [];
  convertElement(root, nodes, undefined, []);
  return nodes;
}

/**
 * Hierarchy provider backed by a live WebDriverAgent.
 *
 * @param baseUrl - WebDriverAgent base URL, e.g. `http://127.0.0.1:8100`.
 * @param display - Visible display size (from WDA `/window/size` or the
 *   simulator size); WDA `/source` carries no display size of its own.
 * @param fetchJson - Optional fetch override (tests inject fixture JSON).
 */
export class WebDriverAgentHierarchyProvider implements HierarchyProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly display: DisplaySize,
    private readonly fetchJson?: (url: string) => Promise<unknown>,
  ) {}

  /**
   * Fetch `/source?format=json` from WebDriverAgent and parse it.
   *
   * @returns Core nodes in document order.
   * @throws TestOrbitError when WebDriverAgent is unreachable or returns
   *   an unparseable payload.
   */
  async dumpHierarchy(): Promise<readonly CoreHierarchyNode[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/source?format=json`;
    let payload: unknown;
    try {
      payload = this.fetchJson !== undefined ? await this.fetchJson(url) : await (await fetch(url)).json();
    } catch (error) {
      throw new TestOrbitError(
        'WDA_UNREACHABLE',
        `Could not reach WebDriverAgent at ${url}: ${error instanceof Error ? error.message : String(error)}`,
        'Start the iOS simulator and WebDriverAgent, then retry on a Mac with a device.',
        { url },
      );
    }
    return parseWdaSource(payload);
  }

  /**
   * @returns The display size configured for this provider.
   */
  async displaySize(): Promise<DisplaySize> {
    return this.display;
  }
}
