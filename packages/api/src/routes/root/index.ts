import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { createRootAuditRoute } from "./audit";
import { createRootDataUsageRoute } from "./dataUsage";
import { createRootIdentitiesRoute } from "./identities";
import { createRootOpsHealthRoute } from "./opsHealth";
import { createRootOrganizationsRoute } from "./organizations";
import { createRootRevenuecatEventsRoute } from "./revenuecatEvents";
import type { RootRouterDeps } from "./shared";
import { createRootSuspensionRoute } from "./suspension";

/**
 * Platform-operator surface for staff and technical support. Every route is
 * gated by `requireAuth` then `requireRoot`; the operations are registered in
 * the protocol registry so the root console reaches them through the typed
 * client, but access is enforced here, never by the client. Every handler
 * records a root audit event before it reads or changes anything.
 */
export function createRootRouter(deps: RootRouterDeps) {
  const rootRouter = new Hono<SessionEnv>();

  rootRouter.route("/", createRootIdentitiesRoute(deps));

  rootRouter.route("/", createRootOrganizationsRoute(deps));

  rootRouter.route("/", createRootDataUsageRoute(deps));

  rootRouter.route("/", createRootOpsHealthRoute(deps));

  rootRouter.route("/", createRootRevenuecatEventsRoute(deps));

  rootRouter.route("/", createRootAuditRoute(deps));

  rootRouter.route("/", createRootSuspensionRoute(deps));

  return rootRouter;
}
