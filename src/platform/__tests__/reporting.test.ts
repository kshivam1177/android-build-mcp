import { describe, expect, it } from 'vitest';
import { toJunitXml } from '../reporting/junit.js';
import type { AutomationRunResult } from '../engine.js';

describe('cross-platform JUnit reporting', () => {
  it('includes attempt counts and run cancellation metadata', () => {
    const result: AutomationRunResult = {
      runId: 'run-1', testId: 'smoke', success: false, cancelled: true, timedOut: false,
      startedAt: new Date().toISOString(), durationMs: 20,
      summary: {
        totalPlatforms: 1, completedPlatforms: 1, passedPlatforms: 0, failedPlatforms: 1,
        totalSteps: 1, failedSteps: 1, retriedSteps: 1, totalAttempts: 2
      },
      platforms: [{
        platform: 'android', success: false, startedAt: new Date().toISOString(), durationMs: 20,
        steps: [{ id: 'snapshot', type: 'assert', status: 'failed', durationMs: 20, attempts: 2, error: 'stale snapshot' }]
      }]
    };
    const xml = toJunitXml(result);
    expect(xml).toContain('name="attempts" value="2"');
    expect(xml).toContain('name="cancelled" value="true"');
    expect(xml).toContain('name="retriedSteps" value="1"');
    expect(xml).toContain('stale snapshot');
  });
});
