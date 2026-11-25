import {
  operationRoutePath,
  verifyOperation,
} from "@tearleads/validators/operation";
import {
  VERIFY_ERROR_CODES,
  type VerifyErrorCode,
  type VerifyResponse,
} from "@tearleads/validators/response";
import { type Context, Hono } from "hono";
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

/** Refusals a client acts on by code rather than by status alone. */
const codedVerifyRefusals: Partial<
  Record<
    VerifyChallengeError["reason"],
    { readonly code: VerifyErrorCode; readonly status: 401 | 403 | 429 }
  >
> = {
  account_suspended: {
    code: VERIFY_ERROR_CODES.accountSuspended,
    status: 403,
  },
  two_factor_invalid: {
    code: VERIFY_ERROR_CODES.twoFactorInvalid,
    status: 401,
  },
  two_factor_locked: {
    code: VERIFY_ERROR_CODES.twoFactorLocked,
    status: 429,
  },
  two_factor_required: {
    code: VERIFY_ERROR_CODES.twoFactorRequired,
    status: 401,
  },
};

function verifyRefusal(c: Context<SessionEnv>, error: VerifyChallengeError) {
  const coded = codedVerifyRefusals[error.reason];
  if (coded) {
    return c.json<VerifyResponse>(
      { authenticated: false, code: coded.code, error: error.message },
      coded.status,
    );
  }
  return c.json<VerifyResponse>(
    { authenticated: false, error: error.message },
    error.reason === "unknown_fingerprint" ? 404 : 401,
  );
}

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
          ...(result.twoFactorDeviceToken === null
            ? {}
            : { twoFactorDeviceToken: result.twoFactorDeviceToken }),
          userId: result.userId,
          wsTicket,
        });
      } catch (error) {
        if (error instanceof VerifyChallengeError) {
          return verifyRefusal(c, error);
        }

        throw error;
      }
    },
  );

  return verifyRoute;
}
