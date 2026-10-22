import {
  listOrganizationMembershipsOperation,
  operationRoutePath,
  updateOrganizationMembershipOperation,
} from "@tearleads/validators/operation";
import type {
  OrganizationMembershipResponse,
  OrganizationMembershipsResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import {
  listOrganizationMemberships,
  updateOrganizationMembership,
} from "../../services/organizations/memberships";
import type { ApiServiceRuntime } from "../../services/runtime";
import { publishBestEffort } from "../../utils/publishBestEffort";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { toOrganizationManagerErrorResponse } from "./shared";

interface OrganizationMembershipsRouteDeps {
  readonly publish: (event: PublishedRealtimeEvent) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

/**
 * The session user's own conduit to each organization they belong to. Every
 * handler reads or writes only the caller's rows, so no organization role is
 * required. A change wakes the user's other clients with a user-scoped hint;
 * the write is already committed, so publishing is best-effort.
 */
export function createOrganizationMembershipsRoute({
  publish,
  requireAuth,
  runtime,
}: OrganizationMembershipsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    listOrganizationMembershipsOperation.method,
    operationRoutePath(listOrganizationMembershipsOperation),
    requireAuth,
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      return c.json<OrganizationMembershipsResponse>(
        await listOrganizationMemberships(runtime, c.get("session").userId),
      );
    },
  );

  route.on(
    updateOrganizationMembershipOperation.method,
    operationRoutePath(updateOrganizationMembershipOperation),
    requireAuth,
    jsonRequestValidator(updateOrganizationMembershipOperation.body),
    pathParamsValidator(
      updateOrganizationMembershipOperation.params,
      "Invalid organization membership route",
    ),
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const userId = c.get("session").userId;
      try {
        const membership = await updateOrganizationMembership(
          runtime,
          organizationId,
          userId,
          c.req.valid("json"),
        );
        await publishBestEffort(
          publish,
          { type: "organization_memberships_changed", userId },
          "organization memberships notification",
        );
        return c.json<OrganizationMembershipResponse>(membership);
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }
        throw error;
      }
    },
  );

  return route;
}
