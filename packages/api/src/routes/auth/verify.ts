import { isVerifyRequest } from "@tearleads/validators/request";
import type { VerifyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  VerifyChallengeError,
  verifyChallenge,
} from "../../services/auth/verifyChallenge";
import { defaultApiServiceRuntime } from "../../services/runtime";

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
    try {
      const result = await verifyChallenge(
        defaultApiServiceRuntime,
        c.req.valid("json"),
      );

      return c.json<VerifyResponse>({
        authenticated: true,
        token: result.token,
      });
    } catch (error) {
      if (error instanceof VerifyChallengeError) {
        const status = error.reason === "unknown_fingerprint" ? 404 : 401;

        return c.json<VerifyResponse>(
          {
            authenticated: false,
            error: error.message,
          },
          status,
        );
      }

      throw error;
    }
  },
);
