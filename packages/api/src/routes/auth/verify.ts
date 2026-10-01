import {
  operationRoutePath,
  verifyOperation,
} from "@tearleads/validators/operation";
import type { VerifyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { readRequestIpAddress } from "../../middleware/requestIp";
import type { SessionEnv } from "../../middleware/session";
import {
  VerifyChallengeError,
  verifyChallenge,
} from "../../services/auth/verifyChallenge";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";

/**
 * `publicOrigin` is the configured origin login challenges must be signed
 * for; null lets each request's own origin stand in (development only).
 */
export function createVerifyRoute(
  runtime: ApiServiceRuntime,
  publicOrigin: string | null,
) {
  const verifyRoute = new Hono<SessionEnv>();

  verifyRoute.on(
    verifyOperation.method,
    operationRoutePath(verifyOperation),
    jsonRequestValidator(verifyOperation.body),
    async (c) => {
      try {
        const result = await verifyChallenge(runtime, {
          ...c.req.valid("json"),
          apiOrigin: publicOrigin ?? new URL(c.req.url).origin,
          ipAddress: readRequestIpAddress(c),
        });

        return c.json<VerifyResponse>({
          authenticated: true,
          isRoot: result.isRoot,
          organizationId: result.organizationId,
          rootContainerId: result.rootContainerId,
          token: result.token,
          userId: result.userId,
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

  return verifyRoute;
}
