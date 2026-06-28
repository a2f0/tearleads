import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createPrincipalPolicyRoute } from "./policy";

interface PrincipalsRouterDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createPrincipalsRouter({
  publish,
  requireAuth,
  runtime,
}: PrincipalsRouterDeps) {
  const principalsRouter = new Hono();
  principalsRouter.route(
    "/",
    createPrincipalPolicyRoute({ publish, requireAuth, runtime }),
  );
  return principalsRouter;
}
