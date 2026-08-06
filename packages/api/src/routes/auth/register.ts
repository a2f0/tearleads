import {
  operationRoutePath,
  registerOperation,
} from "@tearleads/validators/operation";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { readRequestIpAddress } from "../../middleware/session";
import {
  isDuplicateRegistrationFingerprintError,
  RegistrationError,
  registerUser,
} from "../../services/auth/registration";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";

export function createRegisterRoute(runtime: ApiServiceRuntime) {
  const registerRoute = new Hono();

  registerRoute.on(
    registerOperation.method,
    operationRoutePath(registerOperation),
    jsonRequestValidator(registerOperation.body),
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
