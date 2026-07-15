import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  GetUserIdentityError,
  getUserIdentity,
} from "../../services/auth/getUserIdentity";
import type { ApiServiceRuntime } from "../../services/runtime";

interface UserIdentityRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createUserIdentityRoute({
  requireAuth,
  runtime,
}: UserIdentityRouteDeps) {
  const userIdentityRoute = new Hono();

  userIdentityRoute.get(
    "/auth/user-identity/:userId",
    requireAuth,
    async (c) => {
      const userId = c.req.param("userId");

      try {
        return c.json(await getUserIdentity(runtime, userId));
      } catch (error) {
        if (error instanceof GetUserIdentityError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return userIdentityRoute;
}
