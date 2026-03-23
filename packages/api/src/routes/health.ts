import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) => {
  return c.json({ message: "ok" });
});
