import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import type { ApiCorsOrigins } from "../../corsOrigins";
import type { SessionEnv } from "../../middleware/session";
import {
  OrganizationManagerError,
  OrganizationReadModelCursorError,
} from "../../services/organizations/orgManager";
import type { ApiServiceRuntime } from "../../services/runtime";

export interface OrganizationsRouterDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
  /**
   * The app's RESOLVED allowed origins, threaded from the composition root so
   * per-route origin checks (e.g. the Stripe portal's return-url allowlist)
   * cannot diverge from the CORS policy the app was actually built with.
   */
  readonly corsOrigins?: ApiCorsOrigins;
}

export function toOrganizationManagerErrorResponse(
  error: unknown,
): Response | null {
  if (
    error instanceof OrganizationManagerError ||
    error instanceof OrganizationReadModelCursorError
  ) {
    const body = {
      error: error.message,
      ...(error.code === undefined ? {} : { code: error.code }),
    };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      status: error.status,
    });
  }

  return null;
}

export function toOrganizationPresentationErrorResponse(
  error: unknown,
): Response | null {
  if (
    error instanceof OrganizationManagerError &&
    (error.status === 403 || error.status === 404)
  ) {
    return new Response(
      JSON.stringify({
        code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
        error: error.message,
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: error.status,
      },
    );
  }

  return toOrganizationManagerErrorResponse(error);
}
