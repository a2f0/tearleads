import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { isLiveUserSession } from "../middleware/session";
import type { WsConnection } from "./wsConnection";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import type { WsEventRouter } from "./wsRouting";

/** Whether a socket's session is still live in the session store. */
export type ValidateWsSession = (
  identity: WebSocketTicketIdentity,
) => Promise<boolean>;

/**
 * A socket's session is checked once at upgrade. Revocation is published at
 * most once and expiry not at all, so every revalidation pass and subscriber
 * reconnect rechecks it and closes an ended session's sockets (#2365 finding
 * 27). An unreadable session store must not skip the proof re-verification
 * that follows; the next pass rechecks the session.
 *
 * @returns whether the socket's session had ended and its sockets were closed.
 */
export function createWsSessionLivenessCheck(
  router: WsEventRouter,
  validateSession: ValidateWsSession = isLiveUserSession,
): (ws: WsConnection) => Promise<boolean> {
  return async (ws) => {
    try {
      if (await validateSession(ws.data)) return false;
    } catch (error: unknown) {
      reportBackgroundFailure(error, "websocket.revalidate");
      return false;
    }
    router.closeSession(ws.data.userId, ws.data.sessionId);
    return true;
  };
}
