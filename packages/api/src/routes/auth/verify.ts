import { hexToBytes, verify } from "@tearleads/crypto";
import { isVerifyRequest } from "@tearleads/validators/request";
import type { VerifyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { del, get } from "../../adapters/redis";
import { createSession } from "../../middleware/session";

export const verifyRoute = new Hono();

verifyRoute.post(
  "/auth/verify",
  validator("json", (value, c) => {
    if (!isVerifyRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }
    return value;
  }),
  async (c) => {
    const { fingerprint, signature } = c.req.valid("json");

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
      const token = await createSession({
        fingerprint,
        createdAt: Date.now(),
      });
      return c.json<VerifyResponse>({ authenticated: true, token });
    }
    return c.json<VerifyResponse>(
      { authenticated: false, error: "Invalid signature" },
      401,
    );
  },
);
