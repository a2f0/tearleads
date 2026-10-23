export type PostgresConnectionFailureCode =
  | "PG_CONNECT_TIMEOUT"
  | "PG_POOL_TIMEOUT"
  | "PG_CONNECTION_UNAVAILABLE"
  | "PG_CONNECTION_FAILED";

const RETRYABLE_CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "08000",
  "08001",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
]);

/** Exact driver literals only; arbitrary messages never become diagnostic tags. */
export function postgresConnectionFailure(error: unknown): {
  readonly code: PostgresConnectionFailureCode;
  readonly retryable: boolean;
} {
  if (!(error instanceof Error))
    return { code: "PG_CONNECTION_FAILED", retryable: false };
  if (error.message === "timeout exceeded when trying to connect")
    return { code: "PG_POOL_TIMEOUT", retryable: true };
  if (error.message === "Connection terminated due to connection timeout")
    return { code: "PG_CONNECT_TIMEOUT", retryable: true };
  const code: unknown = Reflect.get(error, "code");
  const retryable =
    (typeof code === "string" && RETRYABLE_CONNECTION_CODES.has(code)) ||
    error.message === "Connection terminated unexpectedly";
  return {
    code: retryable ? "PG_CONNECTION_UNAVAILABLE" : "PG_CONNECTION_FAILED",
    retryable,
  };
}

export class PostgresConnectionError extends Error {
  override readonly name = "PostgresConnectionError";
  readonly databaseStage = "connect";

  constructor(
    readonly code: PostgresConnectionFailureCode,
    readonly connectionAttempts: number,
    readonly poolTotal: number,
    readonly poolIdle: number,
    readonly poolWaiting: number,
    cause: unknown,
  ) {
    const driverCode =
      cause instanceof Error ? Reflect.get(cause, "code") : undefined;
    const detail =
      typeof driverCode === "string" &&
      (RETRYABLE_CONNECTION_CODES.has(driverCode) ||
        driverCode === "28P01" ||
        driverCode === "28000")
        ? `${code}; ${driverCode}`
        : code;
    super(`Database connection acquisition failed (${detail})`, { cause });
  }
}
