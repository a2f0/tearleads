import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { db } from "../../adapters/postgres";
import { set } from "../../adapters/redis";
import { publish } from "../../adapters/redisPubSub";
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
    const { signingPublicKey, encapsulationPublicKey } = c.req.valid("json");
    const signingKeyBytes = new Uint8Array(signingPublicKey);
    const encapsulationKeyBytes = new Uint8Array(encapsulationPublicKey);
    const fingerprint = await toFingerprint(signingKeyBytes);

    const [user] = await db
      .insert(users)
      .values({
        fingerprint,
        signingPublicKey: bytesToBase64(signingKeyBytes),
        encapsulationPublicKey: bytesToBase64(encapsulationKeyBytes),
      })
      .onConflictDoNothing({ target: users.fingerprint })
      .returning({ id: users.id });

    if (!user) {
      return c.json({ error: "Key already exists" }, 409);
    }

    await set(fingerprint, bytesToBase64(signingKeyBytes));

    const challengeBytes = generateChallenge();
    const challengeHex = bytesToHex(challengeBytes);
    await set(`challenge:${fingerprint}`, challengeHex, CHALLENGE_TTL_SECONDS);

    await publish({
      type: "user_registered",
      userId: user.id,
      fingerprint,
    });

    return c.json<PublicKeyResponse>({
      message: "ok",
      userId: user.id,
      challenge: challengeHex,
    });
  },
);
