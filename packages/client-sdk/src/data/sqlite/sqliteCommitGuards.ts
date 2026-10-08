import { type ExecSql, resolveCanonicalExecSql } from "./sqlSchema";

const guardsByConnection = new WeakMap<
  ExecSql,
  {
    guards: Set<() => void>;
    failure?: { cause: unknown };
  }
>();

export function beginClientSQLiteCommitGuards(execSql: ExecSql): void {
  guardsByConnection.set(resolveCanonicalExecSql(execSql), {
    guards: new Set(),
  });
}

export function clearClientSQLiteCommitGuards(execSql: ExecSql): void {
  guardsByConnection.delete(resolveCanonicalExecSql(execSql));
}

/** Restore the enclosing guards only after a nested SQL savepoint rolls back. */
export function captureClientSQLiteCommitGuards(execSql: ExecSql): () => void {
  const scope = guardsByConnection.get(resolveCanonicalExecSql(execSql));
  if (!scope)
    throw new Error("Commit guard requires an active runtime transaction");
  const enclosing = new Set(scope.guards);
  return () => {
    scope.guards = enclosing;
  };
}

/** A nested operation's lifetime must remain valid through its outer commit. */
export function registerClientSQLiteCommitGuard(
  execSql: ExecSql,
  assertCurrent: () => void,
): void {
  const guards = guardsByConnection.get(resolveCanonicalExecSql(execSql));
  if (!guards)
    throw new Error("Commit guard requires an active runtime transaction");
  assertCurrent();
  guards.guards.add(assertCurrent);
}

/** Invoke immediately before dispatching COMMIT, without an intervening await. */
export function assertClientSQLiteCommitAllowed(execSql: ExecSql): void {
  const scope = guardsByConnection.get(resolveCanonicalExecSql(execSql));
  if (!scope) return;
  try {
    for (const guard of scope.guards) guard();
  } catch (cause) {
    scope.failure = { cause };
    throw cause;
  }
}

/** Drizzle wraps callback failures; preserve the original cancellation identity. */
export function rethrowClientSQLiteCommitGuardFailure(execSql: ExecSql): void {
  const failure = guardsByConnection.get(
    resolveCanonicalExecSql(execSql),
  )?.failure;
  if (failure) throw failure.cause;
}
