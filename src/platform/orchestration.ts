import { AutomationError } from './contracts.js';

/**
 * Runs independent work with a fixed worker pool. Results retain input order.
 * Once cancelled, no new work is scheduled; active workers receive the same
 * AbortSignal and are awaited so their finally blocks can release resources.
 */
export async function runBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new AutomationError('INVALID_SPEC', 'Concurrency must be an integer between 1 and 32.');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown;
  let failed = false;

  const consume = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted || failed) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));
  if (firstError) throw firstError;
  return results.filter((_value, index) => index < nextIndex && index in results);
}
