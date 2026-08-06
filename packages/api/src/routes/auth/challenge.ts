import {
  challengeOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import {
  CreateChallengeError,
  createChallenge,
} from "../../services/auth/createChallenge";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";

export function createChallengeRoute(runtime: ApiServiceRuntime) {
  const challenge = new Hono();

  challenge.on(
    challengeOperation.method,
    operationRoutePath(challengeOperation),
    jsonRequestValidator(challengeOperation.body),
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
