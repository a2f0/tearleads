import { isCreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  createOrganization,
  OrganizationProvisioningError,
} from "../../services/organizations/createOrganization";
import type { OrganizationsRouterDeps } from "./shared";

export function createOrganizationCreateRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.post(
    "/organizations",
    requireAuth,
    validator("json", (value, c) => {
      if (!isCreateOrganizationRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      try {
        return c.json<CreateOrganizationResponse>(
          await createOrganization(
            runtime,
            c.get("session").userId,
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        if (error instanceof OrganizationProvisioningError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
