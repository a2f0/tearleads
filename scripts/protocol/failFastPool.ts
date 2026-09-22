/**
 * Runs `run` over `items` with at most `parallelism` in flight, in order.
 *
 * `run` resolves to a failure message, or undefined on success. After the first
 * failure no new item starts, but every in-flight item finishes, so no process
 * an item started outlives the pool. A thrown error is recorded as that item's
 * failure rather than rejecting, which would abandon the other in-flight items.
 * Resolves to every failure, in completion order; empty when all succeeded.
 */
export async function runFailFastPool<T>(
  items: readonly T[],
  parallelism: number,
  run: (item: T) => Promise<string | undefined>,
  describe: (item: T) => string,
): Promise<string[]> {
  const queue = items[Symbol.iterator]();
  const failures: string[] = [];
  async function work(): Promise<void> {
    while (failures.length === 0) {
      const next = queue.next();
      if (next.done) {
        return;
      }
      let failure: string | undefined;
      try {
        failure = await run(next.value);
      } catch (error) {
        failure = `${describe(next.value)} could not run: ${String(error)}`;
      }
      if (failure !== undefined) {
        failures.push(failure);
      }
    }
  }
  await Promise.all(Array.from({ length: parallelism }, work));
  return failures;
}
