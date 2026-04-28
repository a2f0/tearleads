import { isPublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  isDuplicateRegisterFingerprintError,
  RegisterPublicKeyError,
  registerPublicKey,
} from "../../services/auth/registerPublicKey";
import type { ApiServiceRuntime } from "../../services/runtime";

export function createRegisterRoute(runtime: ApiServiceRuntime) {
  const registerRoute = new Hono();

  registerRoute.post(
    "/auth/register",
    validator("json", (value, c) => {
      if (!isPublicKeyRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }
      return value;
    }),
    async (c) => {
      try {
        return c.json<PublicKeyResponse>(
          await registerPublicKey(runtime, c.req.valid("json")),
        );
      } catch (error) {
        if (isDuplicateRegisterFingerprintError(error)) {
          return c.json({ error: "Key already exists" }, 409);
        }

        if (error instanceof RegisterPublicKeyError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return registerRoute;
}
