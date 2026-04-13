import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
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
  principalsRouter.route(
    "/",
    createPrincipalPolicyRoute({
      requireAuth,
      runtime,
    }),
  );
  return principalsRouter;
}
