import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
  toFingerprint,
} from "@tearleads/crypto";
import { isPublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { db } from "../../adapters/postgres";
import { set } from "../../adapters/redis";
import { users } from "../../schema";

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

    const [user] = await db
      .insert(users)
      .values({
        fingerprint,
        publicKey: Buffer.from(keyBytes).toString("base64"),
      })
      .onConflictDoNothing({ target: users.fingerprint })
      .returning({ id: users.id });

    if (!user) {
      return c.json({ error: "Key already exists" }, 409);
    }

    await set(fingerprint, Buffer.from(keyBytes).toString("base64"));

    const challengeBytes = generateChallenge();
    const challengeHex = bytesToHex(challengeBytes);
    await set(`challenge:${fingerprint}`, challengeHex, CHALLENGE_TTL_SECONDS);

    return c.json<PublicKeyResponse>({
      message: "ok",
      userId: user.id,
      challenge: challengeHex,
    });
  },
);
