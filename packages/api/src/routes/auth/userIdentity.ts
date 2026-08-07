import {
  operationRoutePath,
  userIdentityOperation,
} from "@tearleads/validators/operation";
import type { UserIdentityResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  GetUserIdentityError,
  getUserIdentity,
} from "../../services/auth/getUserIdentity";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

interface UserIdentityRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createUserIdentityRoute({
  requireAuth,
  runtime,
}: UserIdentityRouteDeps) {
  const userIdentityRoute = new Hono();

  userIdentityRoute.on(
    userIdentityOperation.method,
    operationRoutePath(userIdentityOperation),
    requireAuth,
    pathParamsValidator(userIdentityOperation.params),
    async (c) => {
      const { userId } = c.req.valid("param");

      try {
        return c.json<UserIdentityResponse>(
          await getUserIdentity(runtime, userId),
        );
      } catch (error) {
        return respondToStatusError(c, error, GetUserIdentityError);
      }
    },
  );

  return userIdentityRoute;
}
