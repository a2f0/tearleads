import {
  getHealthOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { HealthResponse } from "@symcrypt/validators/response";
import { Hono } from "hono";

export function createHealthRoute() {
  const health = new Hono();

  health.on(
    getHealthOperation.method,
    operationRoutePath(getHealthOperation),
    async (c) => {
      const body = await c.req.text();
      if (body.length > 0) {
        return c.json({ error: "Body not allowed" }, 413);
      }
      return c.json<HealthResponse>({ message: "ok" });
    },
  );

  return health;
}
