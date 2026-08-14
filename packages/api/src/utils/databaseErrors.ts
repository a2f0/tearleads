/**
 * Cross-dialect database error classification. Drizzle and the underlying
 * drivers wrap failures in `cause` chains, so every predicate here walks the
 * chain (bounded) and matches driver `code` values for both Postgres SQLSTATE
 * and SQLite error names.
 */

export function errorCauseChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

export function isUniqueViolationCode(code: unknown): boolean {
  return (
    code === "23505" ||
    (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT"))
  );
}

/** A unique-constraint violation anywhere in the cause chain. */
export function isUniqueViolation(error: unknown): boolean {
  return errorCauseChain(error).some((candidate) =>
    isUniqueViolationCode(Reflect.get(candidate, "code")),
  );
}

const LIBSQL_TRANSACTION_CONTENTION_CODES = new Set([
  "STREAM_EXPIRED",
  "TRANSACTION_TIMEOUT",
]);

const LIBSQL_TRANSIENT_TRANSPORT_CODES = new Set([
  "HRANA_CLOSED_ERROR",
  "HRANA_PROTO_ERROR",
  "HRANA_WEBSOCKET_ERROR",
]);

function hasDatabaseCode(
  error: unknown,
  predicate: (code: string) => boolean,
): boolean {
  return errorCauseChain(error).some((candidate) => {
    const code = Reflect.get(candidate, "code");
    return typeof code === "string" && predicate(code);
  });
}

function isTransientHttpStatus(status: unknown): boolean {
  return (
    typeof status === "number" &&
    (status === 408 || status === 429 || (status >= 500 && status <= 599))
  );
}

function isTransientLibsqlServerError(error: unknown): boolean {
  const chain = errorCauseChain(error);
  return (
    chain.some(
      (candidate) => Reflect.get(candidate, "code") === "SERVER_ERROR",
    ) &&
    chain.some((candidate) =>
      isTransientHttpStatus(Reflect.get(candidate, "status")),
    )
  );
}

/**
 * Serialization failure or deadlock: the database rolled back the losing
 * transaction and a retry is expected to succeed.
 */
export function isSerializationFailure(error: unknown): boolean {
  return errorCauseChain(error).some((candidate) => {
    const code = Reflect.get(candidate, "code");
    return code === "40001" || code === "40P01";
  });
}

/** SQLite busy/locked contention, the SQLite analog of a serialization race. */
export function isLockContention(error: unknown): boolean {
  return hasDatabaseCode(
    error,
    (code) =>
      code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"),
  );
}

/** Remote database transport failures for which a later request may succeed. */
export function isTransientDatabaseFailure(error: unknown): boolean {
  return (
    hasDatabaseCode(
      error,
      (code) =>
        LIBSQL_TRANSACTION_CONTENTION_CODES.has(code) ||
        LIBSQL_TRANSIENT_TRANSPORT_CODES.has(code),
    ) || isTransientLibsqlServerError(error)
  );
}
