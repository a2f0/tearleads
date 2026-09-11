import { captureApiError } from "./sentry";

/**
 * Reports a failure the caller has already logged and deliberately swallowed:
 * the write had committed, or the socket is past its handshake, so there is no
 * HTTP error response and `createApiErrorHandler` never sees it. The
 * `background-error` source keeps these out of the request 5xx signal.
 */
// The sanitizer rebuilds only the first exception value, so an aggregate would
// arrive as its own construction site with every constituent stack discarded.
// Report the constituents instead, bounded because a sweep aggregates one error
// per item; the transport's signature deduplication collapses the repeats.
const MAX_AGGREGATED_REPORTS = 5;

function reportedFailures(error: unknown): readonly unknown[] {
  if (!(error instanceof AggregateError) || !error.errors.length)
    return [error];
  return error.errors.slice(0, MAX_AGGREGATED_REPORTS);
}

export function reportBackgroundFailure(error: unknown): void {
  try {
    for (const failure of reportedFailures(error)) {
      // Capture synchronously so a batch executable that exits after its work
      // still reports; a `void` return type accepts a rejected promise, so both
      // failure shapes are swallowed rather than surfacing where the caller
      // already chose to continue.
      void Promise.resolve(captureApiError(failure, "background-error")).catch(
        () => undefined,
      );
    }
  } catch {
    // Observability must not alter the outcome the caller already committed to.
  }
}
