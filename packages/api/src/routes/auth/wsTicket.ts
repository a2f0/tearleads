import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  issueWebSocketTicket,
  type WebSocketTicketIdentity,
} from "../../wsTicket";

interface WsTicketRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly issueTicket?: (identity: WebSocketTicketIdentity) => Promise<string>;
}

export function createWsTicketRoute({
  issueTicket = issueWebSocketTicket,
  requireAuth,
}: WsTicketRouteDeps) {
  const wsTicketRoute = new Hono<SessionEnv>();

  wsTicketRoute.post("/auth/ws-ticket", requireAuth, async (c) => {
    const session = c.get("session");
    const ticket = await issueTicket({
      sessionId: session.id,
      userId: session.userId,
    });
    return c.json({ ticket });
  });

  return wsTicketRoute;
}
