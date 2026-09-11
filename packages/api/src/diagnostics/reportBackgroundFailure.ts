import { captureApiError } from "./sentry";

/**
 * Reports a failure the caller has already logged and deliberately swallowed:
 * the write had committed, or the socket is past its handshake, so there is no
 * HTTP error response and `createApiErrorHandler` never sees it. The
 * `background-error` source keeps these out of the request 5xx signal.
 */
export function reportBackgroundFailure(error: unknown): void {
  try {
    // Capture synchronously so a batch executable that exits after its work
    // still reports; a `void` return type accepts a rejected promise, so both
    // failure shapes are swallowed rather than surfacing where the caller
    // already chose to continue.
    void Promise.resolve(captureApiError(error, "background-error")).catch(
      () => undefined,
    );
  } catch {
    // Observability must not alter the outcome the caller already committed to.
  }
}
