import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { SessionEnv } from "./session";

type RootIdentityLookup = (userId: string) => Promise<boolean>;

/**
 * Gate for the internal `/root` administration routes. Runs after
 * `requireAuth` and admits only sessions whose user row carries `is_root`.
 * The flag is a plain operational boolean granted through the API CLI; it is
 * deliberately outside the signed access plane.
 */
export function createRequireRoot(
  isRootIdentity: RootIdentityLookup,
): MiddlewareHandler<SessionEnv> {
  return createMiddleware<SessionEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!(await isRootIdentity(session.userId))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return next();
  });
}
