import { TestOrbitFrameworkError } from '../types.js';
import type { UiBounds, UiNode, UiSnapshot } from '../types.js';

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function parseBounds(raw: string | undefined): UiBounds {
  const match = raw?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!match) return { left: 0, top: 0, right: 0, bottom: 0 };
  const [, l, t, r, b] = match;
  return { left: Number(l), top: Number(t), right: Number(r), bottom: Number(b) };
}

const ATTR_RE = /([a-zA-Z_:][\w:.-]*)="([^"]*)"/g;

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    const name = m[1];
    const value = m[2];
    if (name !== undefined && value !== undefined) attrs[name] = unescapeXml(value);
  }
  return attrs;
}

// Requires attribute content to be well-formed `name="value"` pairs rather
// than stopping at the first `>` - a literal `>` inside a value (e.g.
// text="Settings > Wi-Fi") is valid XML and must not truncate the match.
const TAG_RE = /<node((?:\s+[a-zA-Z_:][\w:.-]*="[^"]*")*)\s*(\/)?>|<\/node>/g;

/**
 * Parser for uiautomator's dump XML (and uiautomator2's dump_hierarchy(),
 * which is the same format). The shape is narrow and regular enough -
 * attribute-only <node> elements, no mixed text content, no namespaces -
 * that a full XML/DOM dependency isn't worth the extra surface.
 */
export function parseUiHierarchy(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  // Stack of open nodes' refs, root first: the top is the current node's
  // parent, the whole stack is its ancestor chain. TestOrbit's stable id
  // derivation (B3) needs both — the old depth-only stack discarded them.
  const refStack: string[] = [];
  let refCounter = 0;
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(xml)) !== null) {
    const [full, attrString, selfClose] = match;
    if (full === '</node>') {
      refStack.pop();
      continue;
    }
    const depth = refStack.length;
    const attrs = parseAttributes(attrString ?? '');
    const bounds = parseBounds(attrs.bounds);
    refCounter += 1;
    const ref = `e${refCounter}`;
    const parentRef = refStack.length > 0 ? refStack[refStack.length - 1] : undefined;
    // Optional UiNode fields are assigned only when present: an explicit
    // `undefined` is not assignable under `exactOptionalPropertyTypes`
    // (the TestOrbit tsconfig).
    const className = attrs.class || undefined;
    const text = attrs.text || undefined;
    const contentDesc = attrs['content-desc'] || undefined;
    const resourceId = attrs['resource-id'] || undefined;
    const packageName = attrs.package || undefined;
    nodes.push({
      ref,
      index: Number(attrs.index ?? nodes.length),
      ...(className !== undefined ? { className } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(contentDesc !== undefined ? { contentDesc } : {}),
      ...(resourceId !== undefined ? { resourceId } : {}),
      ...(packageName !== undefined ? { packageName } : {}),
      bounds,
      centerX: Math.round((bounds.left + bounds.right) / 2),
      centerY: Math.round((bounds.top + bounds.bottom) / 2),
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled === 'true',
      focusable: attrs.focusable === 'true',
      scrollable: attrs.scrollable === 'true',
      checkable: attrs.checkable === 'true',
      checked: attrs.checked === 'true',
      depth,
      ...(parentRef !== undefined ? { parentRef } : {}),
      ancestorChain: [...refStack],
    });
    if (!selfClose) refStack.push(ref);
  }

  return nodes;
}

// In-memory only - scoped to this server process's lifetime, same as
// XcodeBuildMCP's own "refresh after navigation/scrolling" contract for
// snapshot_ui + tap. Keyed by targetId so multiple connected
// devices/emulators don't share stale refs.
const snapshotsByTarget = new Map<string, UiSnapshot>();

export function cacheSnapshot(snapshot: UiSnapshot): void {
  snapshotsByTarget.set(snapshot.targetId, snapshot);
}

export function getCachedSnapshot(targetId: string): UiSnapshot | undefined {
  return snapshotsByTarget.get(targetId);
}

export function resolveElementRef(targetId: string, ref: string): UiNode {
  const snapshot = snapshotsByTarget.get(targetId);
  if (!snapshot) {
    throw new TestOrbitFrameworkError(
      'STALE_SNAPSHOT',
      `No UI snapshot cached for ${targetId} yet. Call snapshot_ui first, then use its elementRef values.`
    );
  }
  const node = snapshot.nodes.find((n) => n.ref === ref);
  if (!node) {
    throw new TestOrbitFrameworkError(
      'ELEMENT_REF_NOT_FOUND',
      `elementRef "${ref}" isn't in the latest snapshot for ${targetId}. The screen may have changed - call snapshot_ui again.`,
      { requestedRef: ref, availableRefs: snapshot.nodes.map((n) => n.ref) }
    );
  }
  return node;
}
