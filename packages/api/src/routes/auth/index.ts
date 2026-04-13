import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { assignIfDefined } from "../../utils/object";
import { createChallengeRoute } from "./challenge";
import { createEncapsulationKeyRoute } from "./encapsulationKey";
import { createLogoutRoute, type LogoutRouteDeps } from "./logout";
import { createRegisterRoute } from "./register";
import { createVerifyRoute } from "./verify";

interface AuthRouterDeps {
  readonly destroySession?: LogoutRouteDeps["destroySession"];
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

type EncapsulationKeyRouteDeps = NonNullable<
  Parameters<typeof createEncapsulationKeyRoute>[0]
>;

export function createAuthRouter({
  destroySession,
  requireAuth,
  runtime,
}: AuthRouterDeps = {}) {
  const auth = new Hono();
  const encapsulationKeyRouteDeps: EncapsulationKeyRouteDeps = {};
  assignIfDefined(encapsulationKeyRouteDeps, "requireAuth", requireAuth);
  assignIfDefined(encapsulationKeyRouteDeps, "runtime", runtime);

  const logoutRouteDeps: LogoutRouteDeps = {};
  assignIfDefined(logoutRouteDeps, "destroySession", destroySession);
  assignIfDefined(logoutRouteDeps, "requireAuth", requireAuth);

  auth.route("/", createChallengeRoute(runtime));
  auth.route("/", createEncapsulationKeyRoute(encapsulationKeyRouteDeps));
  auth.route("/", createRegisterRoute(runtime));
  auth.route("/", createVerifyRoute(runtime));
  auth.route("/", createLogoutRoute(logoutRouteDeps));

  return auth;
}
