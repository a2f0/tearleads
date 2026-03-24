import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import { Hono } from "hono";
import { get, set } from "../../adapters/redis";

const CHALLENGE_TTL_SECONDS = 60;

export const challenge = new Hono();

challenge.post("/auth/challenge", async (c) => {
  const { fingerprint } = await c.req.json();

  const storedKey = await get(fingerprint);
  if (!storedKey) {
    return c.json({ error: "Unknown fingerprint" }, 404);
  }

  const bytes = generateChallenge();
  const challengeHex = bytesToHex(bytes);
  await set(`challenge:${fingerprint}`, challengeHex, CHALLENGE_TTL_SECONDS);

  return c.json({ challenge: challengeHex });
});
