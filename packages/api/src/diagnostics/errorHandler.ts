import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { SessionEnv } from "../middleware/session";
import { isTransientDatabaseFailure } from "../utils/databaseErrors";
import { RequestBodyTooLargeError } from "../validators/requestBodyTooLarge";
import { OrganizationSyncDisabledError } from "../workflows/billing/organizationSyncEligibility";
import { apiRequestContext } from "./requestContext";
import { captureApiError } from "./sentry";

export function createApiErrorHandler(
  capture: typeof captureApiError = captureApiError,
): ErrorHandler<SessionEnv> {
  return (error, c) => {
    // Organization entitlement and stable-seat failures surface uniformly as 402.
    if (error instanceof OrganizationSyncDisabledError) {
      return c.json(
        {
          error: error.message,
          organizationId: error.organizationId,
          reason: error.reason,
        },
        402,
      );
    }
    if (error instanceof HTTPException && error.status < 500) {
      return error.getResponse();
    }
    // The Worker ingress bounds streamed bodies as the route reads them.
    if (error instanceof RequestBodyTooLargeError) {
      return c.json({ error: "Request body too large" }, 413);
    }
    const status =
      error instanceof HTTPException
        ? error.status
        : isTransientDatabaseFailure(error)
          ? 503
          : 500;
    capture(error, "request-error", undefined, apiRequestContext(c, status));
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    if (status === 503) {
      return c.json({ error: "Database temporarily unavailable" }, 503);
    }
    return c.json({ error: "Internal Server Error" }, 500);
  };
}
