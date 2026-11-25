import {
  operationRoutePath,
  updateOrganizationRosterEntryOperation,
  updateOrganizationRosterTwoFactorOperation,
} from "@tearleads/validators/operation";
import type { OrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  updateOrganizationRosterEntry,
  updateOrganizationRosterTwoFactor,
} from "../../services/organizations/orgManager";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import {
  type OrganizationRosterRouteDeps,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationRosterRoute({
  requireAuth,
  runtime,
  sessions,
}: OrganizationRosterRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    updateOrganizationRosterEntryOperation.method,
    operationRoutePath(updateOrganizationRosterEntryOperation),
    requireAuth,
    jsonRequestValidator(updateOrganizationRosterEntryOperation.body),
    pathParamsValidator(
      updateOrganizationRosterEntryOperation.params,
      "Invalid roster route",
    ),
    async (c) => {
      const { organizationId, userId } = c.req.valid("param");

      try {
        return c.json<OrganizationDirectoryUserResponse>(
          await updateOrganizationRosterEntry(
            runtime,
            organizationId,
            userId,
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

  route.on(
    updateOrganizationRosterTwoFactorOperation.method,
    operationRoutePath(updateOrganizationRosterTwoFactorOperation),
    requireAuth,
    jsonRequestValidator(updateOrganizationRosterTwoFactorOperation.body),
    pathParamsValidator(
      updateOrganizationRosterTwoFactorOperation.params,
      "Invalid roster route",
    ),
    async (c) => {
      const { organizationId, userId } = c.req.valid("param");

      try {
        return c.json<OrganizationDirectoryUserResponse>(
          await updateOrganizationRosterTwoFactor(runtime, sessions, {
            organizationId,
            request: c.req.valid("json"),
            sessionUserId: c.get("session").userId,
            userId,
          }),
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

  return route;
}
