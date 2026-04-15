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

  logoutRoute.post("/auth/logout", requireAuth, async (c) => {
    await destroySession(c);
    return c.json({ message: "ok" });
  });

  return logoutRoute;
}
