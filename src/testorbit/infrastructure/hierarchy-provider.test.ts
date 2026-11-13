import { describe, expect, it } from 'vitest';
import { AndroidHierarchyProvider } from './hierarchy-provider.js';

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
<node index="0" text="Pay ₹499" resource-id="com.shop.app:id/pay_now" class="android.widget.Button" package="com.shop.app" content-desc="Pay now" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[10,20][110,70]"></node>
</node>
</hierarchy>`;

describe('AndroidHierarchyProvider', () => {
  it('converts a uiautomator dump into core nodes with parent refs', async () => {
    const provider = new AndroidHierarchyProvider(
      async () => XML,
      async () => ({ width: 1080, height: 2400 }),
    );
    const nodes = await provider.dumpHierarchy();
    expect(nodes).toHaveLength(2);
    const button = nodes[1];
    expect(button?.resourceId).toBe('com.shop.app:id/pay_now');
    expect(button?.contentDesc).toBe('Pay now');
    expect(button?.text).toBe('Pay ₹499');
    expect(button?.clickable).toBe(true);
    expect(button?.parentRef).toBe(nodes[0]?.ref);
    expect(button?.ancestorChain).toEqual([nodes[0]?.ref]);
    expect(await provider.displaySize()).toEqual({ width: 1080, height: 2400 });
  });
});
