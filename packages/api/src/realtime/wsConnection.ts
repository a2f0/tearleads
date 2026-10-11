import type { WebSocketTicketIdentity } from "./wsIdentity";

/** The authenticated websocket subset required by the pure routers. */
export interface WsConnection {
  readonly data: WebSocketTicketIdentity;
  close?(code?: number, reason?: string): unknown;
  send(message: string): unknown;
}

/**
 * A socket the gateway owns: routable like any connection, and closable. Bun's
 * `ServerWebSocket` and the Durable Object's accepted socket wrapper both
 * satisfy it, so the gateway's handlers are runtime-neutral.
 */
export interface GatewaySocket extends WsConnection {
  close(code?: number, reason?: string): unknown;
}

export function sessionKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

export function socketSessionKey(ws: WsConnection): string {
  return sessionKey(ws.data.userId, ws.data.sessionId);
}

export function isSameSession(
  ws: WsConnection,
  origin: WebSocketTicketIdentity,
): boolean {
  return (
    ws.data.userId === origin.userId && ws.data.sessionId === origin.sessionId
  );
}

export function closeSafely(
  ws: WsConnection,
  code: number,
  reason: string,
): void {
  try {
    ws.close?.(code, reason);
  } catch {
    // A broken/closing socket must not block revocation for the others.
  }
}

export function sendSafely(ws: WsConnection, message: string): void {
  try {
    ws.send(message);
  } catch {
    // A broken/closing socket must not block delivery to later recipients.
  }
}
