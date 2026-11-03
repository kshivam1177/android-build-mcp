import { describe, expect, it } from 'vitest';
import { toJunitXml } from '../reporting/junit.js';
import type { AutomationRunResult } from '../engine.js';

describe('JUnit reporter', () => {
  it('escapes XML and counts failures and skipped cases', () => {
    const result: AutomationRunResult = {
      runId: 'r1', testId: 'checkout & payment', success: false, startedAt: new Date(0).toISOString(), durationMs: 1200,
      platforms: [{ platform: 'web', success: false, startedAt: new Date(0).toISOString(), durationMs: 1200,
        steps: [{ id: 'submit <form>', type: 'tap', status: 'failed', durationMs: 100, error: 'bad <value>' }] }]
    };
    const xml = toJunitXml(result);
    expect(xml).toContain('checkout &amp; payment');
    expect(xml).toContain('failures="2"');
    expect(xml).toContain('submit &lt;form&gt;');
  });
});
