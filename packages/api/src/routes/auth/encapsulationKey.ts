import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "../../middleware/session";
import {
  GetEncapsulationKeyError,
  getEncapsulationKey,
} from "../../services/auth/getEncapsulationKey";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "../../services/runtime";

interface EncapsulationKeyRouteDeps {
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createEncapsulationKeyRoute({
  requireAuth = defaultRequireAuth,
  runtime = defaultApiServiceRuntime,
}: EncapsulationKeyRouteDeps = {}) {
  const encapsulationKeyRoute = new Hono();

  encapsulationKeyRoute.get(
    "/auth/encapsulation-key/:userId",
    requireAuth,
    async (c) => {
      const userId = c.req.param("userId");

      try {
        return c.json(await getEncapsulationKey(runtime, userId));
      } catch (error) {
        if (error instanceof GetEncapsulationKeyError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return encapsulationKeyRoute;
}

export const encapsulationKeyRoute = createEncapsulationKeyRoute();
