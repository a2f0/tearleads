import { captureApiError } from "./sentry";

/**
 * Reports a failure the caller has already logged and deliberately swallowed:
 * the write had committed, or the socket is past its handshake, so there is no
 * HTTP error response and `createApiErrorHandler` never sees it. The
 * `background-error` source keeps these out of the request 5xx signal.
 */
// The sanitizer rebuilds only the first exception value, so an aggregate would
// arrive as its own construction site with every constituent stack discarded.
// Report the leaves instead, bounded because a sweep aggregates one error per
// item; the transport's signature deduplication collapses the repeats.
const MAX_AGGREGATED_REPORTS = 5;
// Blob maintenance nests them: it wraps each phase's own aggregate inside the
// one it throws, so stopping at the first level would report a second
// construction site instead of the failure. Bounded like `errorCauseChain`.
const MAX_AGGREGATE_DEPTH = 5;

function collectReportedFailures(
  error: unknown,
  collected: unknown[],
  depth: number,
): void {
  if (collected.length >= MAX_AGGREGATED_REPORTS) return;
  if (
    depth < MAX_AGGREGATE_DEPTH &&
    error instanceof AggregateError &&
    error.errors.length
  ) {
    for (const nested of error.errors) {
      collectReportedFailures(nested, collected, depth + 1);
    }
    return;
  }
  collected.push(error);
}

function reportedFailures(error: unknown): readonly unknown[] {
  const collected: unknown[] = [];
  collectReportedFailures(error, collected, 0);
  return collected;
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
