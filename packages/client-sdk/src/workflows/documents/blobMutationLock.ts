import {
  type ExecSql,
  resolveCanonicalExecSql,
} from "../../data/sqlite/sqlSchema";

const mutationQueuesByExecSql = new WeakMap<
  ExecSql,
  Map<string, Promise<void>>
>();

/**
 * Serialize byte-store mutations that address the same document blob key.
 *
 * Lock order is blob key, then the connection-wide SQL mutation lock. Callers
 * must not acquire this lock from inside `runSerializedSqlMutation`.
 */
export async function runSerializedDocumentBlobMutation<T>(
  execSql: ExecSql,
  storageKey: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const canonicalExecSql = resolveCanonicalExecSql(execSql);
  const queues = mutationQueuesByExecSql.get(canonicalExecSql) ?? new Map();
  mutationQueuesByExecSql.set(canonicalExecSql, queues);

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
        mutationQueuesByExecSql.delete(canonicalExecSql);
      }
    }
  }
}
