import { toFingerprint } from "@tearleads/crypto";
import { isPublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { set } from "../../adapters/redis";

export const registerRoute = new Hono();

registerRoute.post(
  "/auth/register",
  validator("json", (value, c) => {
    if (!isPublicKeyRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }
    return value;
  }),
  async (c) => {
    const { publicKey } = c.req.valid("json");
    const keyBytes = new Uint8Array(publicKey);
    const fingerprint = await toFingerprint(keyBytes);
    await set(fingerprint, JSON.stringify(publicKey));
    return c.json<PublicKeyResponse>({ message: "ok" });
  },
);
