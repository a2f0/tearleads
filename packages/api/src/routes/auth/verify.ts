import { hexToBytes, verify } from "@tearleads/crypto";
import type { VerifyRequest } from "@tearleads/validators/request";
import type { VerifyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { del, get } from "../../adapters/redis";

export const verifyRoute = new Hono();

verifyRoute.post("/auth/verify", async (c) => {
  const { fingerprint, signature } = await c.req.json<VerifyRequest>();

  const challengeHex = await get(`challenge:${fingerprint}`);
  if (!challengeHex) {
    return c.json<VerifyResponse>(
      { error: "Challenge expired or not found", authenticated: false },
      401,
    );
  }

  await del(`challenge:${fingerprint}`);

  const storedKey = await get(fingerprint);
  if (!storedKey) {
    return c.json<VerifyResponse>(
      { error: "Unknown fingerprint", authenticated: false },
      404,
    );
  }

  const publicKey = new Uint8Array(JSON.parse(storedKey));
  const challengeBytes = hexToBytes(challengeHex);
  const signatureBytes = new Uint8Array(signature);

  const valid = verify(signatureBytes, challengeBytes, publicKey);

  if (valid) {
    return c.json<VerifyResponse>({ authenticated: true });
  }
  return c.json<VerifyResponse>(
    { authenticated: false, error: "Invalid signature" },
    401,
  );
});
