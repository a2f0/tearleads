import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { assignIfDefined } from "../../utils/object";
import { createPrincipalPolicyRoute, principalPolicyRoute } from "./policy";

export const principalsRouter = new Hono();

principalsRouter.route("/", principalPolicyRoute);

interface PrincipalsRouterDeps {
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createPrincipalsRouter({
  requireAuth,
  runtime,
}: PrincipalsRouterDeps = {}) {
  const principalsRouter = new Hono();
  const routeDeps: PrincipalsRouterDeps = {};
  assignIfDefined(routeDeps, "requireAuth", requireAuth);
  assignIfDefined(routeDeps, "runtime", runtime);

  principalsRouter.route("/", createPrincipalPolicyRoute(routeDeps));
  return principalsRouter;
}
