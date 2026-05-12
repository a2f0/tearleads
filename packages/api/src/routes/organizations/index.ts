import { isCreateOrganizationGroupRequest } from "@tearleads/validators/request";
import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { isUuidV4String } from "@tearleads/validators/util";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  createOrganizationGroup,
  listOrganizationDirectory,
  listOrganizationGroupMembers,
  listOrganizationGroups,
  OrganizationManagerError,
} from "../../services/organizations/orgManager";
import type { ApiServiceRuntime } from "../../services/runtime";

interface OrganizationsRouterDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

function toOrganizationManagerErrorResponse(error: unknown): Response | null {
  if (error instanceof OrganizationManagerError) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: error.status,
    });
  }

  return null;
}

function parseOrganizationId(value: string): string | null {
  return isUuidV4String(value) ? value : null;
}

function parseGroupId(value: string): string | null {
  return isUuidV4String(value) ? value : null;
}

function addDirectoryRoute(
  organizationsRouter: Hono,
  { requireAuth, runtime }: OrganizationsRouterDeps,
): void {
  organizationsRouter.get(
    "/organizations/:organizationId/directory",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        return c.json<OrganizationDirectoryResponse>(
          await listOrganizationDirectory(
            runtime,
            organizationId,
            c.get("session").userId,
          ),
        );
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );
}

function addListGroupsRoute(
  organizationsRouter: Hono,
  { requireAuth, runtime }: OrganizationsRouterDeps,
): void {
  organizationsRouter.get(
    "/organizations/:organizationId/groups",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        return c.json<ListOrganizationGroupsResponse>(
          await listOrganizationGroups(
            runtime,
            organizationId,
            c.get("session").userId,
          ),
        );
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );
}

function addCreateGroupRoute(
  organizationsRouter: Hono,
  { requireAuth, runtime }: OrganizationsRouterDeps,
): void {
  organizationsRouter.post(
    "/organizations/:organizationId/groups",
    requireAuth,
    validator("json", (value, c) => {
      if (!isCreateOrganizationGroupRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        return c.json<OrganizationGroupSummaryResponse>(
          await createOrganizationGroup(
            runtime,
            organizationId,
            c.get("session").userId,
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );
}

function addGroupMembersRoute(
  organizationsRouter: Hono,
  { requireAuth, runtime }: OrganizationsRouterDeps,
): void {
  organizationsRouter.get(
    "/organizations/:organizationId/groups/:groupId/members",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      const groupId = parseGroupId(c.req.param("groupId"));
      if (!organizationId || !groupId) {
        return c.json({ error: "Invalid organization group route" }, 400);
      }

      try {
        return c.json<OrganizationGroupMembersResponse>(
          await listOrganizationGroupMembers(
            runtime,
            organizationId,
            groupId,
            c.get("session").userId,
          ),
        );
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );
}

export function createOrganizationsRouter(deps: OrganizationsRouterDeps) {
  const organizationsRouter = new Hono();

  addDirectoryRoute(organizationsRouter, deps);
  addListGroupsRoute(organizationsRouter, deps);
  addCreateGroupRoute(organizationsRouter, deps);
  addGroupMembersRoute(organizationsRouter, deps);

  return organizationsRouter;
}
