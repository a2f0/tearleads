import { toFingerprint } from "@tearleads/crypto";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { set } from "../adapters/redis";

export const publicKeyRoute = new Hono();

publicKeyRoute.post("/publicKey", async (c) => {
  const { publicKey } = await c.req.json<PublicKeyRequest>();
  const keyBytes = new Uint8Array(publicKey);
  const fingerprint = await toFingerprint(keyBytes);
  await set(fingerprint, JSON.stringify(publicKey));
  return c.json<PublicKeyResponse>({ message: "ok" });
});
