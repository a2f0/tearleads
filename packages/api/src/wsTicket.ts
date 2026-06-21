import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { hasStringProperty } from "@tearleads/validators/util";
import { getdel, set } from "./adapters/redis";

// One-time, short-lived ticket that authenticates a websocket upgrade. Browsers
// cannot attach an Authorization header to a WebSocket handshake, so an
// authenticated HTTP request mints a ticket that the upgrade consumes from the
// query string. The ticket is the only Redis state this adds: a single key with
// a short TTL, deleted on first use.
const WS_TICKET_PREFIX = "ws-ticket:";
const WS_TICKET_TTL_SECONDS = 60;

export interface WebSocketTicketIdentity {
  readonly userId: string;
  readonly sessionId: string;
}

function ticketKey(ticket: string): string {
  return `${WS_TICKET_PREFIX}${ticket}`;
}

function parseTicketIdentity(raw: string): WebSocketTicketIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    isPlainObject(parsed) &&
    hasStringProperty(parsed, "userId") &&
    hasStringProperty(parsed, "sessionId")
  ) {
    return { sessionId: parsed.sessionId, userId: parsed.userId };
  }

  return null;
}

export async function issueWebSocketTicket(
  identity: WebSocketTicketIdentity,
): Promise<string> {
  const ticket = bytesToHex(generateChallenge(32));
  await set(ticketKey(ticket), JSON.stringify(identity), WS_TICKET_TTL_SECONDS);
  return ticket;
}

/**
 * Atomically validate and consume a ticket. Returns the authenticated identity
 * the ticket was issued for, or null when the ticket is missing, malformed,
 * expired, or already consumed — all of which the upgrade path treats as an
 * authentication failure.
 */
export async function consumeWebSocketTicket(
  ticket: string,
): Promise<WebSocketTicketIdentity | null> {
  if (ticket.length === 0) {
    return null;
  }

  const raw = await getdel(ticketKey(ticket));
  return raw === null ? null : parseTicketIdentity(raw);
}
