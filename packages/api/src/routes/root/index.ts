import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { createRootDataUsageRoute } from "./dataUsage";
import { createRootIdentitiesRoute } from "./identities";
import { createRootOrganizationsRoute } from "./organizations";
import type { RootRouterDeps } from "./shared";

/**
 * Platform-operator surface for staff and technical support. Every route is
 * gated by `requireAuth` then `requireRoot`; the operations are registered in
 * the protocol registry so the root console reaches them through the typed
 * client, but access is enforced here, never by the client.
 */
export function createRootRouter(deps: RootRouterDeps) {
  const rootRouter = new Hono<SessionEnv>();

  rootRouter.route("/", createRootIdentitiesRoute(deps));

  rootRouter.route("/", createRootOrganizationsRoute(deps));

  rootRouter.route("/", createRootDataUsageRoute(deps));

  return rootRouter;
}
