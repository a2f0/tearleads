import { isUuidV4String } from "@tearleads/validators/util";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { OrganizationManagerError } from "../../services/organizations/orgManager";
import type { ApiServiceRuntime } from "../../services/runtime";

export interface OrganizationsRouterDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function toOrganizationManagerErrorResponse(
  error: unknown,
): Response | null {
  if (error instanceof OrganizationManagerError) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: error.status,
    });
  }

  return null;
}

export function parseOrganizationId(value: string): string | null {
  return isUuidV4String(value) ? value : null;
}

export function parseGroupId(value: string): string | null {
  return isUuidV4String(value) ? value : null;
}

export function parseUserId(value: string): string | null {
  return isUuidV4String(value) ? value : null;
}
