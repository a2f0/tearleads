import { Hono } from "hono";
import { destroySession, requireAuth } from "../../middleware/session";

export const logoutRoute = new Hono();

logoutRoute.post("/auth/logout", requireAuth, async (c) => {
  await destroySession(c);
  return c.json({ message: "ok" });
});
