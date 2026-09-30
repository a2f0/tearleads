import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { isLiveUserSession } from "../middleware/session";
import { socketSessionKey, type WsConnection } from "./wsConnection";
import type { WebSocketTicketIdentity, WsSessionValidator } from "./wsIdentity";
import type { WsEventRouter } from "./wsRouting";

export interface WsSessionLivenessCheck {
  /** Rechecks one socket's session on its revalidation tick. */
  readonly checkSocket: (ws: WsConnection) => Promise<void>;
  /** Rechecks each open session once, on a subscriber reconnect. */
  readonly checkAll: (sockets: readonly WsConnection[]) => Promise<void>;
}

/**
 * A socket's session is checked once at upgrade. Revocation is published at
 * most once and expiry not at all, so every revalidation pass and subscriber
 * reconnect rechecks it and closes an ended session's sockets (#2365 finding
 * 27). The recheck runs beside proof re-verification, never ahead of it: the
 * session store may hang or fail through the same outage that caused a
 * reconnect, and the next pass rechecks. A failed pass logs and reports once.
 */
export function createWsSessionLivenessCheck(
  router: WsEventRouter,
  validateSession: WsSessionValidator = isLiveUserSession,
): WsSessionLivenessCheck {
  const closeIfEnded = async (identity: WebSocketTicketIdentity) => {
    if (await validateSession(identity)) return;
    router.closeSession(identity.userId, identity.sessionId);
  };
  const reportFailures = (failures: readonly unknown[]) => {
    const [first] = failures;
    if (first === undefined) return;
    console.error(
      `Failed to check ${failures.length} websocket session(s) for liveness:`,
      first,
    );
    reportBackgroundFailure(first, "websocket.revalidate");
  };
  return {
    checkSocket: (ws) =>
      closeIfEnded(ws.data).catch((error: unknown) => reportFailures([error])),
    async checkAll(sockets) {
      const sessions = new Map<string, WebSocketTicketIdentity>();
      for (const ws of sockets) sessions.set(socketSessionKey(ws), ws.data);
      const results = await Promise.allSettled(
        [...sessions.values()].map(closeIfEnded),
      );
      reportFailures(
        results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        ),
      );
    },
  };
}
