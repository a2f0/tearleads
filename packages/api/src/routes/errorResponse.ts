import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { captureApiError } from "../diagnostics/sentry";

type StatusErrorClass = abstract new (
  ...args: never[]
) => Error & { readonly status: ContentfulStatusCode };

interface CodedStatus {
  readonly code: string;
  readonly status: ContentfulStatusCode;
}

/**
 * Standard route catch epilogue: a domain error carrying an HTTP status maps to
 * its `{ error }` body, optionally with an exact code for one status; anything
 * else propagates to the 500 handler.
 */
export function respondToStatusError(
  c: Context,
  error: unknown,
  errorClass: StatusErrorClass,
  codedStatus?: CodedStatus,
): Response {
  if (error instanceof errorClass) {
    // A 500+ status is a server fault, but returning it here means `onError`
    // never sees it, so capture at this seam instead. The response itself is
    // deliberately unchanged: `onError` would answer a deliberate 503 with a
    // generic 500 unless its cause chain happens to look like driver
    // contention, turning a retryable outcome into a permanent one.
    if (error.status >= 500) captureApiError(error, "request-error");
    return c.json(
      {
        ...(codedStatus?.status === error.status
          ? { code: codedStatus.code }
          : {}),
        error: error.message,
      },
      error.status,
    );
  }

  throw error;
}
