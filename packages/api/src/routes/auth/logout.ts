import {
  logoutOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { DestroySessionResponse } from "@symcrypt/validators/response";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";

export interface LogoutRouteDeps {
  readonly destroySession: (c: Context) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
}

export function createLogoutRoute({
  destroySession,
  requireAuth,
}: LogoutRouteDeps) {
  const logoutRoute = new Hono();

  logoutRoute.on(
    logoutOperation.method,
    operationRoutePath(logoutOperation),
    requireAuth,
    async (c) => {
      await destroySession(c);
      return c.json<DestroySessionResponse>({ message: "ok" });
    },
  );

  return logoutRoute;
}
