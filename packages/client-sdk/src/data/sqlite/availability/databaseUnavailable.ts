import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";

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
// they can only be matched on text. A worker crash belongs here too: the app's
// database lifecycle observes it directly and reports it once, so the callers
// whose requests it rejected treat it as the database going away rather than
// each reporting their own copy.
const DESTROYED_DATABASE_CLIENT_MESSAGES = [
  "Database client is unavailable.",
  "Database worker client has been destroyed.",
  "Database worker failed.",
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

// How far a cause chain is followed; bounded so a cyclic cause cannot loop.
const BUSY_CAUSE_DEPTH_LIMIT = 8;

// True when the SQLite worker refused a statement because another connection
// (another tab) held a transaction on the database for the lease's wait bound.
// The statement did not run, and the same work succeeds once that transaction
// ends, so it is never evidence about the work: keying verification, writer-key
// resolution, boot, and the retry paths keep it out of verdicts and retry
// budgets (`classifyDatabaseFailure`, `retryWhileDatabaseBusy`). Unlike an
// unavailable database nothing announces when it clears, so it is not one of
// those: the work re-runs on its caller's own retry schedule.
export function isDatabaseTransactionBusyError(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < BUSY_CAUSE_DEPTH_LIMIT && current instanceof Error;
    depth += 1
  ) {
    if (current.message.includes(DATABASE_TRANSACTION_BUSY_MESSAGE)) {
      return true;
    }
    current = current.cause;
  }

  return false;
}
