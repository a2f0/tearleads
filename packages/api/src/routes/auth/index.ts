import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createChallengeRoute } from "./challenge";
import { createEncapsulationKeyRoute } from "./encapsulationKey";
import { createLogoutRoute, type LogoutRouteDeps } from "./logout";
import { createRegisterRoute } from "./register";
import { createVerifyRoute } from "./verify";

interface AuthRouterDeps {
  readonly destroySession: LogoutRouteDeps["destroySession"];
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createAuthRouter({
  destroySession,
  requireAuth,
  runtime,
}: AuthRouterDeps) {
  const auth = new Hono();

  auth.route("/", createChallengeRoute(runtime));
  auth.route("/", createEncapsulationKeyRoute({ requireAuth, runtime }));
  auth.route("/", createRegisterRoute(runtime));
  auth.route("/", createVerifyRoute(runtime));
  auth.route("/", createLogoutRoute({ destroySession, requireAuth }));

  return auth;
}
