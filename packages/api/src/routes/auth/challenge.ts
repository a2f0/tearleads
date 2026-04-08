import { isChallengeRequest } from "@tearleads/validators/request";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createChallenge } from "../../services/auth/createChallenge";
import { defaultApiServiceRuntime } from "../../services/runtime";

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
    const result = await createChallenge(
      defaultApiServiceRuntime,
      c.req.valid("json"),
    );

    return c.json<ChallengeErrorResponse | ChallengeResponse>(
      result.body,
      result.status,
    );
  },
);
