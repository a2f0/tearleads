import type { HealthResponse } from "@tearleads/validators/response";
import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) => {
  return c.json<HealthResponse>({ message: "ok" });
});
