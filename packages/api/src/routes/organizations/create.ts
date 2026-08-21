import {
  createOrganizationOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { CreateOrganizationResponse } from "@symcrypt/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  createOrganization,
  OrganizationProvisioningError,
} from "../../services/organizations/createOrganization";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { respondToStatusError } from "../errorResponse";
import type { OrganizationsRouterDeps } from "./shared";

export function createOrganizationCreateRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    createOrganizationOperation.method,
    operationRoutePath(createOrganizationOperation),
    requireAuth,
    jsonRequestValidator(createOrganizationOperation.body),
    async (c) => {
      const session = c.get("session");
      try {
        return c.json<CreateOrganizationResponse>(
          await createOrganization(
            runtime,
            session.userId,
            session.id,
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        return respondToStatusError(c, error, OrganizationProvisioningError);
      }
    },
  );

  return route;
}
