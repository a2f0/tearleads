import { isRegistrationRequest } from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { readRequestIpAddress } from "../../middleware/session";
import {
  isDuplicateRegistrationFingerprintError,
  RegistrationError,
  registerUser,
} from "../../services/auth/registration";
import type { ApiServiceRuntime } from "../../services/runtime";

export function createRegisterRoute(runtime: ApiServiceRuntime) {
  const registerRoute = new Hono();

  registerRoute.post(
    "/auth/register",
    validator("json", (value, c) => {
      if (!isRegistrationRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }
      return value;
    }),
    async (c) => {
      try {
        return c.json<RegistrationResponse>(
          await registerUser(runtime, c.req.valid("json"), {
            sourceIpAddress: readRequestIpAddress(c),
          }),
        );
      } catch (error) {
        if (isDuplicateRegistrationFingerprintError(error)) {
          return c.json({ error: "Key already exists, try logging in" }, 409);
        }

        if (error instanceof RegistrationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return registerRoute;
}
