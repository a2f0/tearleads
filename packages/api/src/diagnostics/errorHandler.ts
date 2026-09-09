import type { ServerErrorSource } from "@tearleads/diagnostics/server";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { SessionEnv } from "../middleware/session";
import { isTransientDatabaseFailure } from "../utils/databaseErrors";
import { OrganizationSyncDisabledError } from "../workflows/billing/organizationSyncEligibility";
import { captureApiError } from "./sentry";

export function createApiErrorHandler(
  capture: (
    error: unknown,
    source: ServerErrorSource,
  ) => void = captureApiError,
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
    capture(error, "request-error");
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    if (isTransientDatabaseFailure(error)) {
      return c.json({ error: "Database temporarily unavailable" }, 503);
    }
    return c.json({ error: "Internal Server Error" }, 500);
  };
}
