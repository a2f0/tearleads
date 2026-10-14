import {
  operationRoutePath,
  verifyOperation,
} from "@tearleads/validators/operation";
import type { VerifyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { readRequestIpAddress } from "../../middleware/requestIp";
import type { SessionEnv } from "../../middleware/session";
import type { WebSocketTicketIdentity } from "../../realtime/wsIdentity";
import { issueWebSocketTicket } from "../../realtime/wsTicket";
import {
  VerifyChallengeError,
  verifyChallenge,
} from "../../services/auth/verifyChallenge";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";

/**
 * `publicOrigin` is the configured origin login challenges must be signed
 * for; null lets each request's own origin stand in (development only). A
 * successful login also returns the new session's first websocket ticket, the
 * same single-use ticket `POST /auth/ws-ticket` mints, so the first connect
 * needs no extra request.
 */
export function createVerifyRoute(
  runtime: ApiServiceRuntime,
  publicOrigin: string | null,
  issueTicket: (
    identity: WebSocketTicketIdentity,
  ) => Promise<string> = issueWebSocketTicket,
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
        const wsTicket = await issueTicket({
          sessionId: result.sessionId,
          userId: result.userId,
        });

        return c.json<VerifyResponse>({
          authenticated: true,
          isRoot: result.isRoot,
          organizationId: result.organizationId,
          rootContainerId: result.rootContainerId,
          token: result.token,
          userId: result.userId,
          wsTicket,
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
