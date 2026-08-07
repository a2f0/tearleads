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
  return errorCauseChain(error).some((candidate) => {
    const code = Reflect.get(candidate, "code");
    return (
      typeof code === "string" &&
      (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))
    );
  });
}
