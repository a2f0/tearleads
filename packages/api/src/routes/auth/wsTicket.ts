import {
  operationRoutePath,
  webSocketTicketOperation,
} from "@symcrypt/validators/operation";
import type { WebSocketTicketResponse } from "@symcrypt/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { WebSocketTicketIdentity } from "../../realtime/wsIdentity";
import { issueWebSocketTicket } from "../../realtime/wsTicket";

interface WsTicketRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly issueTicket?: (identity: WebSocketTicketIdentity) => Promise<string>;
}

export function createWsTicketRoute({
  issueTicket = issueWebSocketTicket,
  requireAuth,
}: WsTicketRouteDeps) {
  const wsTicketRoute = new Hono<SessionEnv>();

  wsTicketRoute.on(
    webSocketTicketOperation.method,
    operationRoutePath(webSocketTicketOperation),
    requireAuth,
    async (c) => {
      const session = c.get("session");
      const ticket = await issueTicket({
        sessionId: session.id,
        userId: session.userId,
      });
      return c.json<WebSocketTicketResponse>({ ticket });
    },
  );

  return wsTicketRoute;
}
