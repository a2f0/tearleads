import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { createRootIdentitiesRoute } from "./identities";
import type { RootRouterDeps } from "./shared";

/**
 * Internal platform-operator surface for staff and technical support. Every
 * route is gated by `requireAuth` then `requireRoot`; nothing here is part of
 * the public protocol operation registry or the generated OpenAPI contract.
 */
export function createRootRouter(deps: RootRouterDeps) {
  const rootRouter = new Hono<SessionEnv>();

  rootRouter.route("/", createRootIdentitiesRoute(deps));

  return rootRouter;
}
