import { ORGANIZATION_TWO_FACTOR_ERROR_CODES } from "@tearleads/validators/response";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { SessionEnv } from "../middleware/session";
import { isTransientDatabaseFailure } from "../utils/databaseErrors";
import { OrganizationTwoFactorRequiredError } from "../utils/requestTwoFactorStanding";
import { RequestBodyTooLargeError } from "../validators/requestBodyTooLarge";
import { OrganizationSyncDisabledError } from "../workflows/billing/organizationSyncEligibility";
import { apiRequestContext } from "./requestContext";
import { captureApiError } from "./sentry";

function unhandledErrorStatus(error: unknown): number {
  if (error instanceof HTTPException) return error.status;
  return isTransientDatabaseFailure(error) ? 503 : 500;
}

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
    // Distinct from an access denial, which tells clients to drop the
    // organization's local projection; this one asks for a second factor.
    if (error instanceof OrganizationTwoFactorRequiredError) {
      return c.json(
        {
          code: ORGANIZATION_TWO_FACTOR_ERROR_CODES.required,
          error: error.message,
          organizationId: error.organizationId,
        },
        error.status,
      );
    }
    if (error instanceof HTTPException && error.status < 500) {
      return error.getResponse();
    }
    // The Worker ingress bounds streamed bodies as the route reads them.
    if (error instanceof RequestBodyTooLargeError) {
      return c.json({ error: "Request body too large" }, 413);
    }
    const status = unhandledErrorStatus(error);
    capture(error, "request-error", undefined, apiRequestContext(c, status));
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    if (status === 503) {
      return c.json({ error: "Database temporarily unavailable" }, 503);
    }
    return c.json({ error: "Internal Server Error" }, 500);
  };
}
