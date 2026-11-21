// Runs on the main thread.
//
// An uncaught exception inside the SQLite worker reaches its owner as an
// `ErrorEvent` whose `error` is null across the agent boundary, so the only
// `Error` that can carry a stack is one minted here. This module is bundled into
// the application chunk, never into the worker script, so the resulting frame is
// one the diagnostics allowlist admits — and a single, stable location that
// tells "the database worker crashed" apart from every other database failure.

const WORKER_CRASH_MESSAGE = "Database worker failed.";

export interface WorkerCrashDetail {
  readonly message: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
}

export class DatabaseWorkerCrashError extends Error {
  readonly detail: WorkerCrashDetail;

  constructor(detail: WorkerCrashDetail) {
    super(
      detail.message.length > 0
        ? `${WORKER_CRASH_MESSAGE} ${detail.message}`
        : WORKER_CRASH_MESSAGE,
    );
    this.name = "DatabaseWorkerCrashError";
    this.detail = detail;
  }
}

const CONNECTION_LOST_DETAIL =
  "The database connection was lost when the tab that owned it closed. Open the database again.";

/**
 * A client's open database went away with the owner tab whose worker held it.
 * Hosts handle it as a crash (retire the runtime, open a new one) but it is the
 * expected result of closing or reloading a tab, not a defect: report it below
 * error level. The inherited message prefix keeps "the database went away"
 * classifiers matching it.
 */
export class DatabaseConnectionLostError extends DatabaseWorkerCrashError {
  constructor() {
    super({ message: CONNECTION_LOST_DETAIL });
    this.name = "DatabaseConnectionLostError";
  }
}

export function isDatabaseConnectionLostError(
  error: unknown,
): error is DatabaseConnectionLostError {
  return error instanceof DatabaseConnectionLostError;
}

export function describeWorkerErrorEvent(event: Event): WorkerCrashDetail {
  if (!(event instanceof ErrorEvent)) {
    return { message: "" };
  }

  return {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  };
}

// Reuses an `Error` the event already carries: the cross-tab coordinator
// dispatches synthetic events that hold the instance minted at the catch site,
// so every listener sees the same stack instead of one rooted in itself.
export function workerCrashErrorFromEvent(event: Event): Error {
  if (event instanceof ErrorEvent && event.error instanceof Error) {
    return event.error;
  }

  return new DatabaseWorkerCrashError(describeWorkerErrorEvent(event));
}
