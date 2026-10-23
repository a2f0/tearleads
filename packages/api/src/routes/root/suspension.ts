import {
  liftRootIdentitySuspensionOperation,
  operationRoutePath,
  suspendRootIdentityOperation,
} from "@tearleads/validators/operation";
import type { RootIdentitySuspensionResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { RootIdentityError } from "../../services/root/identities";
import {
  liftIdentitySuspension,
  suspendIdentity,
} from "../../services/root/identitySuspension";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";
import { auditRootRequest, type RootRouterDeps } from "./shared";

/**
 * Account suspension, the console's only write. The request is recorded
 * before anything changes, refused ones included, so an operator's attempt to
 * suspend a root identity is on the trail too.
 */
export function createRootSuspensionRoute({
  destroyUserSession,
  listUserSessions,
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    suspendRootIdentityOperation.method,
    operationRoutePath(suspendRootIdentityOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(suspendRootIdentityOperation.params, "Invalid userId"),
    async (c) => {
      const { userId } = c.req.valid("param");
      try {
        await auditRootRequest(c, runtime, {
          action: suspendRootIdentityOperation.id,
          targetUserId: userId,
        });
        return c.json<RootIdentitySuspensionResponse>({
          identity: await suspendIdentity(
            runtime,
            { destroyUserSession, listUserSessions },
            userId,
          ),
        });
      } catch (error) {
        return respondToStatusError(c, error, RootIdentityError);
      }
    },
  );

  route.on(
    liftRootIdentitySuspensionOperation.method,
    operationRoutePath(liftRootIdentitySuspensionOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(
      liftRootIdentitySuspensionOperation.params,
      "Invalid userId",
    ),
    async (c) => {
      const { userId } = c.req.valid("param");
      try {
        await auditRootRequest(c, runtime, {
          action: liftRootIdentitySuspensionOperation.id,
          targetUserId: userId,
        });
        return c.json<RootIdentitySuspensionResponse>({
          identity: await liftIdentitySuspension(runtime, userId),
        });
      } catch (error) {
        return respondToStatusError(c, error, RootIdentityError);
      }
    },
  );

  return route;
}
