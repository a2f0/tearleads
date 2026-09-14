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
