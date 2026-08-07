import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type StatusErrorClass = abstract new (
  ...args: never[]
) => Error & { readonly status: ContentfulStatusCode };

/**
 * Standard route catch epilogue: a domain error carrying an HTTP status maps
 * to its `{ error }` body; anything else propagates to the 500 handler.
 */
export function respondToStatusError(
  c: Context,
  error: unknown,
  errorClass: StatusErrorClass,
): Response {
  if (error instanceof errorClass) {
    return c.json({ error: error.message }, error.status);
  }

  throw error;
}
