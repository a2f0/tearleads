import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { createOrganizationDirectoryRoute } from "./directory";
import { createOrganizationGrantsRoute } from "./grants";
import { createOrganizationGroupsRoute } from "./groups";
import { createOrganizationMutationsRoute } from "./mutations";
import type { OrganizationsRouterDeps } from "./shared";

export function createOrganizationsRouter(deps: OrganizationsRouterDeps) {
  const organizationsRouter = new Hono<SessionEnv>();

  organizationsRouter.route("/", createOrganizationDirectoryRoute(deps));
  organizationsRouter.route("/", createOrganizationGrantsRoute(deps));
  organizationsRouter.route("/", createOrganizationGroupsRoute(deps));
  organizationsRouter.route("/", createOrganizationMutationsRoute(deps));

  return organizationsRouter;
}
