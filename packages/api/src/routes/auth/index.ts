import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { assignIfDefined } from "../../utils/object";
import { challenge, createChallengeRoute } from "./challenge";
import {
  createEncapsulationKeyRoute,
  encapsulationKeyRoute,
} from "./encapsulationKey";
import { createLogoutRoute, type LogoutRouteDeps, logoutRoute } from "./logout";
import { createRegisterRoute, registerRoute } from "./register";
import { createVerifyRoute, verifyRoute } from "./verify";

export const auth = new Hono();

auth.route("/", challenge);
auth.route("/", encapsulationKeyRoute);
auth.route("/", registerRoute);
auth.route("/", verifyRoute);
auth.route("/", logoutRoute);

interface AuthRouterDeps {
  readonly destroySession?: LogoutRouteDeps["destroySession"];
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createAuthRouter({
  destroySession,
  requireAuth,
  runtime,
}: AuthRouterDeps = {}) {
  const auth = new Hono();
  const encapsulationKeyRouteDeps: Parameters<
    typeof createEncapsulationKeyRoute
  >[0] = {};
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
