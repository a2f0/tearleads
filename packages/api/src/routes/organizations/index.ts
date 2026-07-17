import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { createOrganizationCreateRoute } from "./create";
import { createOrganizationDataUsageRoute } from "./dataUsage";
import { createOrganizationDirectoryRoute } from "./directory";
import { createOrganizationGrantsRoute } from "./grants";
import { createOrganizationGroupsRoute } from "./groups";
import { createOrganizationMutationsRoute } from "./mutations";
import { createOrganizationProfileRoute } from "./profile";
import { createOrganizationReadModelRoute } from "./readModel";
import { createOrganizationRosterRoute } from "./roster";
import type { OrganizationsRouterDeps } from "./shared";
import { createOrganizationUsersRoute } from "./users";

export function createOrganizationsRouter(deps: OrganizationsRouterDeps) {
  const organizationsRouter = new Hono<SessionEnv>();

  organizationsRouter.route("/", createOrganizationCreateRoute(deps));
  organizationsRouter.route("/", createOrganizationDataUsageRoute(deps));
  organizationsRouter.route("/", createOrganizationDirectoryRoute(deps));
  organizationsRouter.route("/", createOrganizationGrantsRoute(deps));
  organizationsRouter.route("/", createOrganizationGroupsRoute(deps));
  organizationsRouter.route("/", createOrganizationMutationsRoute(deps));
  organizationsRouter.route("/", createOrganizationProfileRoute(deps));
  organizationsRouter.route("/", createOrganizationReadModelRoute(deps));
  organizationsRouter.route("/", createOrganizationRosterRoute(deps));
  organizationsRouter.route("/", createOrganizationUsersRoute(deps));

  return organizationsRouter;
}
