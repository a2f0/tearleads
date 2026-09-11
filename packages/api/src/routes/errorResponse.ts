import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type StatusErrorClass = abstract new (
  ...args: never[]
) => Error & { readonly status: ContentfulStatusCode };

interface CodedStatus {
  readonly code: string;
  readonly status: ContentfulStatusCode;
}

/**
 * Standard route catch epilogue: a domain error carrying a client HTTP status
 * maps to its `{ error }` body, optionally with an exact code for one status;
 * a 500+ domain error and anything else propagates to the 500 handler.
 */
export function respondToStatusError(
  c: Context,
  error: unknown,
  errorClass: StatusErrorClass,
  codedStatus?: CodedStatus,
): Response {
  // A 500+ status is a server fault, not a client outcome. Returning it here
  // would produce a real 500 that `onError` never sees, so the API's single
  // capture site would miss it and the raw message would reach the client.
  if (error instanceof errorClass && error.status < 500) {
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
