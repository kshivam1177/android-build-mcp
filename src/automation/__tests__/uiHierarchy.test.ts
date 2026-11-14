import { describe, it, expect, beforeEach } from 'vitest';
import { parseUiHierarchy, cacheSnapshot, resolveElementRef, getCachedSnapshot } from '../uiHierarchy.js';

const SAMPLE_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
    <node index="0" text="Settings &gt; Wi-Fi" resource-id="com.example.app:id/title" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,100][600,200]">
    </node>
    <node index="1" text="" resource-id="com.example.app:id/toggle" class="android.widget.Switch" package="com.example.app" content-desc="Enable Wi-Fi" checkable="true" checked="true" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[900,100][1000,200]">
    </node>
  </node>
</hierarchy>`;

describe('parseUiHierarchy', () => {
  it('parses every node with correct refs, bounds, and center points', () => {
    const nodes = parseUiHierarchy(SAMPLE_XML);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]?.ref).toBe('e1');
    expect(nodes[0]?.className).toBe('android.widget.FrameLayout');
    expect(nodes[0]?.depth).toBe(0);

    const title = nodes[1];
    expect(title?.depth).toBe(1);
    expect(title?.clickable).toBe(true);
    expect(title?.bounds).toEqual({ left: 40, top: 100, right: 600, bottom: 200 });
    expect(title?.centerX).toBe(320);
    expect(title?.centerY).toBe(150);
  });

  it('unescapes XML entities, including a literal > inside a quoted value', () => {
    const nodes = parseUiHierarchy(SAMPLE_XML);
    expect(nodes[1]?.text).toBe('Settings > Wi-Fi');
  });

  it('emits parentRef and ancestorChain for every node', () => {
    const nodes = parseUiHierarchy(SAMPLE_XML);
    expect(nodes[0]?.parentRef).toBeUndefined();
    expect(nodes[0]?.ancestorChain).toEqual([]);
    expect(nodes[1]?.parentRef).toBe('e1');
    expect(nodes[1]?.ancestorChain).toEqual(['e1']);
    expect(nodes[2]?.parentRef).toBe('e1');
    expect(nodes[2]?.ancestorChain).toEqual(['e1']);
  });

  it('builds multi-level ancestor chains in document order', () => {
    const xml = '<hierarchy rotation="0">'
      + '<node index="0" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">'
      + '<node index="0" class="android.widget.LinearLayout" bounds="[0,0][1080,2400]">'
      + '<node index="0" resource-id="com.example.app:id/deep" class="android.widget.Button" bounds="[0,0][100,50]"></node>'
      + '</node></node></hierarchy>';
    const nodes = parseUiHierarchy(xml);
    expect(nodes).toHaveLength(3);
    expect(nodes[2]?.parentRef).toBe('e2');
    expect(nodes[2]?.ancestorChain).toEqual(['e1', 'e2']);
  });

  it('parses checkable/checked and content-desc for a switch', () => {
    const nodes = parseUiHierarchy(SAMPLE_XML);
    const toggle = nodes[2];
    expect(toggle?.checkable).toBe(true);
    expect(toggle?.checked).toBe(true);
    expect(toggle?.contentDesc).toBe('Enable Wi-Fi');
  });

  it('returns an empty array for hierarchy XML with no nodes', () => {
    expect(parseUiHierarchy('<hierarchy rotation="0"></hierarchy>')).toEqual([]);
  });
});

describe('snapshot cache + resolveElementRef', () => {
  beforeEach(() => {
    // Each test gets a fresh targetId so caches from other tests don't leak in.
  });

  it('resolves a cached ref to its node', () => {
    const nodes = parseUiHierarchy(SAMPLE_XML);
    cacheSnapshot({ targetId: 'test-device-1', capturedAt: new Date().toISOString(), backend: 'adb', nodes });
    const resolved = resolveElementRef('test-device-1', 'e2');
    expect(resolved.text).toBe('Settings > Wi-Fi');
    expect(getCachedSnapshot('test-device-1')?.nodes).toHaveLength(3);
  });

  it('throws STALE_SNAPSHOT for a target with no cached snapshot', () => {
    expect(() => resolveElementRef('never-snapshotted-device', 'e1')).toThrowError(/STALE_SNAPSHOT|No UI snapshot cached/);
  });

  it('throws ELEMENT_REF_NOT_FOUND for an unknown ref on a known target', () => {
    const nodes = parseUiHierarchy(SAMPLE_XML);
    cacheSnapshot({ targetId: 'test-device-2', capturedAt: new Date().toISOString(), backend: 'adb', nodes });
    expect(() => resolveElementRef('test-device-2', 'e999')).toThrowError(/ELEMENT_REF_NOT_FOUND|isn't in the latest snapshot/);
  });
});
