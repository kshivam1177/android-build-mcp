import { describe, expect, it } from 'vitest';
import { runBounded } from '../orchestration.js';

describe('runBounded', () => {
  it('limits concurrent workers and preserves input order', async () => {
    let active = 0;
    let peak = 0;
    const result = await runBounded([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });
    expect(peak).toBe(2);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it('does not schedule additional work after cancellation', async () => {
    const controller = new AbortController();
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = runBounded([1, 2, 3, 4], 2, async (value) => {
      started += 1;
      await gate;
      return value;
    }, controller.signal);
    await Promise.resolve();
    controller.abort();
    release();
    const result = await running;
    expect(started).toBe(2);
    expect(result).toHaveLength(2);
  });

  it('rejects unsafe concurrency values', async () => {
    await expect(runBounded([1], 0, async (value) => value)).rejects.toThrow('between 1 and 32');
  });
});
