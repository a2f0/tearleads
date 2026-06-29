import type { DatabaseSession, DatabaseTransaction } from "./types";

/**
 * Narrow an executor to an active transaction.
 *
 * Drizzle pins a transaction to a single pooled connection, so every query it
 * issues multiplexes onto one `pg` client. The root database, by contrast,
 * hands each query its own pooled connection. We detect a transaction via
 * `rollback`, which drizzle exposes on transaction objects but never on the
 * root database surface.
 */
function isDatabaseTransaction(
  executor: DatabaseSession,
): executor is DatabaseTransaction {
  return (
    typeof executor === "object" &&
    executor !== null &&
    typeof Reflect.get(executor, "rollback") === "function"
  );
}

/**
 * Resolve a set of independent queries over an executor with the concurrency
 * its connection model allows.
 *
 * On the root database each query gets its own pooled connection, so the reads
 * fan out concurrently. Inside a transaction every query shares one pinned
 * connection: concurrency there buys nothing and trips pg's "client is already
 * executing a query" deprecation, so the reads run serially instead.
 *
 * Reach for this anywhere you would otherwise `Promise.all` over an array of
 * executor-bound queries — it keeps the connection model a property of the
 * executor rather than a decision each call site has to re-derive.
 */
export async function gatherWithExecutor<Item, Result>(
  executor: DatabaseSession,
  items: readonly Item[],
  run: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (isDatabaseTransaction(executor)) {
    const results: Result[] = [];
    for (const [index, item] of items.entries()) {
      results.push(await run(item, index));
    }
    return results;
  }

  return Promise.all(items.map((item, index) => run(item, index)));
}
