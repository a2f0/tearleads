import type { HealthResponse } from "@tearleads/validators/response";
import { Hono } from "hono";

export function createHealthRoute() {
  const health = new Hono();

  health.get("/", async (c) => {
    const body = await c.req.text();
    if (body.length > 0) {
      return c.json({ error: "Body not allowed" }, 413);
    }
    return c.json<HealthResponse>({ message: "ok" });
  });

  return health;
}
