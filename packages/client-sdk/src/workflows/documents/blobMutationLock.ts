import type { ExecSql } from "../../data/sqlite/sqlSchema";

const mutationQueuesByExecSql = new WeakMap<
  ExecSql,
  Map<string, Promise<void>>
>();

/** Serialize byte-store mutations that address the same document blob key. */
export async function runSerializedDocumentBlobMutation<T>(
  execSql: ExecSql,
  storageKey: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const queues = mutationQueuesByExecSql.get(execSql) ?? new Map();
  mutationQueuesByExecSql.set(execSql, queues);

  const previous = queues.get(storageKey) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const waitForPrevious = previous.catch(() => undefined);
  const queuedCurrent = waitForPrevious.then(() => current);
  queues.set(storageKey, queuedCurrent);
  await waitForPrevious;

  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (queues.get(storageKey) === queuedCurrent) {
      queues.delete(storageKey);
      if (queues.size === 0) {
        mutationQueuesByExecSql.delete(execSql);
      }
    }
  }
}
