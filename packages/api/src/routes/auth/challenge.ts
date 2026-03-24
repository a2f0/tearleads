import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import { isChallengeRequest } from "@tearleads/validators/request";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { get, set } from "../../adapters/redis";

const CHALLENGE_TTL_SECONDS = 60;

export const challenge = new Hono();

challenge.post(
  "/auth/challenge",
  validator("json", (value, c) => {
    if (!isChallengeRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }
    return value;
  }),
  async (c) => {
    const { fingerprint } = c.req.valid("json");

    const storedKey = await get(fingerprint);
    if (!storedKey) {
      return c.json<ChallengeErrorResponse>(
        { error: "Unknown fingerprint" },
        404,
      );
    }

    const bytes = generateChallenge();
    const challengeHex = bytesToHex(bytes);
    await set(`challenge:${fingerprint}`, challengeHex, CHALLENGE_TTL_SECONDS);

    return c.json<ChallengeResponse>({ challenge: challengeHex });
  },
);
