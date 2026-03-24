import { hexToBytes, verify } from "@tearleads/crypto";
import { Hono } from "hono";
import { del, get } from "../../adapters/redis";

export const verifyRoute = new Hono();

verifyRoute.post("/auth/verify", async (c) => {
  const { fingerprint, signature } = await c.req.json();

  const challengeHex = await get(`challenge:${fingerprint}`);
  if (!challengeHex) {
    return c.json({ error: "Challenge expired or not found" }, 401);
  }

  await del(`challenge:${fingerprint}`);

  const storedKey = await get(fingerprint);
  if (!storedKey) {
    return c.json({ error: "Unknown fingerprint" }, 404);
  }

  const publicKey = new Uint8Array(JSON.parse(storedKey));
  const challengeBytes = hexToBytes(challengeHex);
  const signatureBytes = new Uint8Array(signature);

  const valid = verify(signatureBytes, challengeBytes, publicKey);

  if (valid) {
    return c.json({ authenticated: true });
  }
  return c.json({ authenticated: false, error: "Invalid signature" }, 401);
});
