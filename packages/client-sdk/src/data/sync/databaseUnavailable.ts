// "The database was not there", as distinct from "the work was wrong".
//
// The runtime is released and rebooted underneath in-flight callers on every
// identity switch, logout, and Explorer retry, so any long, network-bound
// operation can lose its database at an await. Callers that treat a vanishing
// database as a benign outcome — sync lanes, hydration, device-first projection
// — discriminate on this module rather than on message text or a domain code.

// Raised when database-backed work is asked for while the database is not ready.
//
// Throw this instead of reusing a domain error code: the predicate below
// discriminates structurally on the type, so a genuine failure that happens to
// share a code is never silently swallowed.
export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

// These come from the SQLite worker and its client, which raise plain Errors, so
// they can only be matched on text.
const DESTROYED_DATABASE_CLIENT_MESSAGES = [
  "Database client is unavailable.",
  "Database worker client has been destroyed.",
  "DB has been closed.",
] as const;

// True when an error means the database went away, not that the caller was
// wrong. A lane that hits this did not fail — it lost its runtime mid-flight and
// re-runs once the database is ready again.
export function isDatabaseUnavailableError(error: unknown): boolean {
  let current = error;

  while (current instanceof Error) {
    if (current instanceof DatabaseUnavailableError) {
      return true;
    }

    const errorMessage = current.message;
    if (
      DESTROYED_DATABASE_CLIENT_MESSAGES.some((message) =>
        errorMessage.includes(message),
      )
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
}
