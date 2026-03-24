import { toFingerprint } from "@tearleads/crypto";
import { isPublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { set } from "../adapters/redis";

export const publicKeyRoute = new Hono();

publicKeyRoute.post("/publicKey", async (c) => {
  const body = await c.req.json();
  if (!isPublicKeyRequest(body)) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const { publicKey } = body;
  const keyBytes = new Uint8Array(publicKey);
  const fingerprint = await toFingerprint(keyBytes);
  await set(fingerprint, JSON.stringify(publicKey));
  return c.json<PublicKeyResponse>({ message: "ok" });
});
