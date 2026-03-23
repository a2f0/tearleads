import { Hono } from "hono";

export const publicKey = new Hono();

publicKey.post("/publicKey", (c) => {
  return c.json({ message: "ok" });
});
