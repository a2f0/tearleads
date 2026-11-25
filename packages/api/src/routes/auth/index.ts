import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createChallengeRoute } from "./challenge";
import { createLogoutRoute, type LogoutRouteDeps } from "./logout";
import { createRegisterRoute } from "./register";
import { createSessionsRoute, type SessionsRouteDeps } from "./sessions";
import { createTwoFactorRoute, type TwoFactorRouteDeps } from "./twoFactor";
import { createUserIdentityRoute } from "./userIdentity";
import { createVerifyRoute } from "./verify";
import { createWsTicketRoute } from "./wsTicket";

interface AuthRouterDeps {
  readonly destroySession: LogoutRouteDeps["destroySession"];
  readonly destroyUserSession: SessionsRouteDeps["destroyUserSession"];
  readonly listUserSessions: SessionsRouteDeps["listUserSessions"];
  readonly publicOrigin: string | null;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
  readonly updateSessionTwoFactorStanding: TwoFactorRouteDeps["sessions"]["updateSessionTwoFactorStanding"];
}

export function createAuthRouter({
  destroySession,
  destroyUserSession,
  listUserSessions,
  publicOrigin,
  requireAuth,
  runtime,
  updateSessionTwoFactorStanding,
}: AuthRouterDeps) {
  const auth = new Hono();

  auth.route("/", createChallengeRoute(runtime));
  auth.route("/", createUserIdentityRoute({ requireAuth, runtime }));
  auth.route("/", createRegisterRoute(runtime));
  auth.route("/", createVerifyRoute(runtime, publicOrigin));
  auth.route("/", createLogoutRoute({ destroySession, requireAuth }));
  auth.route("/", createWsTicketRoute({ requireAuth }));
  auth.route(
    "/",
    createSessionsRoute({ destroyUserSession, listUserSessions, requireAuth }),
  );
  auth.route(
    "/",
    createTwoFactorRoute({
      requireAuth,
      runtime,
      sessions: {
        destroyUserSession,
        listUserSessions,
        updateSessionTwoFactorStanding,
      },
    }),
  );

  return auth;
}
