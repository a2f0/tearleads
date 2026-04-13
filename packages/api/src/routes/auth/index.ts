import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { challenge, createChallengeRoute } from "./challenge";
import {
  createEncapsulationKeyRoute,
  encapsulationKeyRoute,
} from "./encapsulationKey";
import { createLogoutRoute, logoutRoute } from "./logout";
import { createRegisterRoute, registerRoute } from "./register";
import { createVerifyRoute, verifyRoute } from "./verify";

export const auth = new Hono();

auth.route("/", challenge);
auth.route("/", encapsulationKeyRoute);
auth.route("/", registerRoute);
auth.route("/", verifyRoute);
auth.route("/", logoutRoute);

interface AuthRouterDeps {
  readonly destroySession?: Parameters<
    typeof createLogoutRoute
  >[0]["destroySession"];
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createAuthRouter({
  destroySession,
  requireAuth,
  runtime,
}: AuthRouterDeps = {}) {
  const auth = new Hono();

  auth.route("/", createChallengeRoute(runtime));
  auth.route(
    "/",
    createEncapsulationKeyRoute({
      requireAuth,
      runtime,
    }),
  );
  auth.route("/", createRegisterRoute(runtime));
  auth.route("/", createVerifyRoute(runtime));
  auth.route(
    "/",
    createLogoutRoute({
      destroySession,
      requireAuth,
    }),
  );

  return auth;
}
