/**
 * Postgres error classification. Drizzle and the underlying drivers wrap
 * failures in `cause` chains, so every predicate here walks the chain
 * (bounded) and matches the driver's SQLSTATE `code`.
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
  return code === "23505";
}

/** A unique-constraint violation anywhere in the cause chain. */
export function isUniqueViolation(error: unknown): boolean {
  return errorCauseChain(error).some((candidate) =>
    isUniqueViolationCode(Reflect.get(candidate, "code")),
  );
}

function hasDatabaseCode(
  error: unknown,
  predicate: (code: string) => boolean,
): boolean {
  return errorCauseChain(error).some((candidate) => {
    const code = Reflect.get(candidate, "code");
    return typeof code === "string" && predicate(code);
  });
}

/**
 * Serialization failure or deadlock: the database rolled back the losing
 * transaction and a retry is expected to succeed.
 */
export function isSerializationFailure(error: unknown): boolean {
  return hasDatabaseCode(error, (code) => code === "40001" || code === "40P01");
}

/** Database connection failures for which a later request may succeed. */
export function isTransientDatabaseFailure(error: unknown): boolean {
  return hasDatabaseCode(
    error,
    (code) =>
      code === "PG_CONNECT_TIMEOUT" ||
      code === "PG_POOL_TIMEOUT" ||
      code === "PG_CONNECTION_UNAVAILABLE",
  );
}
