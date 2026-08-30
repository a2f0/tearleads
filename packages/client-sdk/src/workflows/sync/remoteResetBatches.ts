// Keep bulk inserts, IN predicates, and expanded pair predicates comfortably
// below SQLite's common 999-bind and expression-depth limits. Some queued rows
// consume more than ten binds each, so one conservative size covers every
// reset statement.
export const REMOTE_RESET_SQL_BATCH_SIZE = 50;

export function remoteResetBatches<T>(
  values: readonly T[],
): readonly (readonly T[])[] {
  const batches: T[][] = [];
  for (
    let offset = 0;
    offset < values.length;
    offset += REMOTE_RESET_SQL_BATCH_SIZE
  ) {
    batches.push(values.slice(offset, offset + REMOTE_RESET_SQL_BATCH_SIZE));
  }
  return batches;
}
