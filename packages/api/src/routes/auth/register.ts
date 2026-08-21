import {
  operationRoutePath,
  registerOperation,
} from "@symcrypt/validators/operation";
import type { RegistrationResponse } from "@symcrypt/validators/response";
import { Hono } from "hono";
import {
  readRequestIpAddress,
  type SessionEnv,
} from "../../middleware/session";
import {
  isDuplicateRegistrationFingerprintError,
  RegistrationError,
  registerUser,
} from "../../services/auth/registration";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { respondToStatusError } from "../errorResponse";

export function createRegisterRoute(runtime: ApiServiceRuntime) {
  const registerRoute = new Hono<SessionEnv>();

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

        return respondToStatusError(c, error, RegistrationError);
      }
    },
  );

  return registerRoute;
}
