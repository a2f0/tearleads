import { isChallengeRequest } from "@tearleads/validators/request";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  CreateChallengeError,
  createChallenge,
} from "../../services/auth/createChallenge";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "../../services/runtime";

export function createChallengeRoute(
  runtime: ApiServiceRuntime = defaultApiServiceRuntime,
) {
  const challenge = new Hono();

  challenge.post(
    "/auth/challenge",
    validator("json", (value, c) => {
      if (!isChallengeRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }
      return value;
    }),
    async (c) => {
      try {
        const result = await createChallenge(runtime, c.req.valid("json"));

        return c.json<ChallengeResponse>({ challenge: result.challenge });
      } catch (error) {
        if (error instanceof CreateChallengeError) {
          return c.json<ChallengeErrorResponse>({ error: error.message }, 404);
        }

        throw error;
      }
    },
  );

  return challenge;
}

export const challenge = createChallengeRoute();
