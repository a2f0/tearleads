import { toFingerprint } from "@tearleads/crypto";
import { Hono } from "hono";
import { set } from "../adapters/redis";

export const publicKey = new Hono();

publicKey.post("/publicKey", async (c) => {
  const { publicKey: key } = await c.req.json();
  const keyBytes = new Uint8Array(key);
  const fingerprint = await toFingerprint(keyBytes);
  await set(fingerprint, JSON.stringify(key));
  return c.json({ message: "ok" });
});
