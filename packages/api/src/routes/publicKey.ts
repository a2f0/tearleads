import { Hono } from "hono";
import { set } from "../adapters/redis";

export const publicKey = new Hono();

publicKey.post("/publicKey", async (c) => {
  const { publicKey: key } = await c.req.json();
  await set("publicKey", JSON.stringify(key));
  return c.json({ message: "ok" });
});
