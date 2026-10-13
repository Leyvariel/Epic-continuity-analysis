/** Stop scheduling on the first failure, abort peers and settle them before returning. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, signal: AbortSignal, run: (item: T, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit');
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const results = new Array<R>(items.length);
  let cursor = 0, failed = false, failure: unknown;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { combined.throwIfAborted(); results[index] = await run(items[index], combined); }
      catch (error) { if (!failed) { failed = true; failure = error; controller.abort(); } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failure;
  signal.throwIfAborted();
  return results;
}
