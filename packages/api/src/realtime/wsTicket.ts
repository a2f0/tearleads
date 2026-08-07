import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { hasStringProperty, isUuidV4String } from "@tearleads/validators/util";
import { getdel, set } from "../adapters/redis";
import { isLiveUserSession } from "../middleware/session";
import { isSessionId } from "../validators/session";
import type { WebSocketTicketIdentity } from "./wsIdentity";

// One-time, short-lived ticket that authenticates a websocket upgrade. Browsers
// cannot attach an Authorization header to a WebSocket handshake, so an
// authenticated HTTP request mints a ticket that the upgrade consumes from the
// query string. The ticket is the only Redis state this adds: a single key with
// a short TTL, deleted on first use.
const WS_TICKET_PREFIX = "ws-ticket:";
const WS_TICKET_TTL_SECONDS = 60;

type WebSocketTicketSessionValidator = (
  identity: WebSocketTicketIdentity,
) => Promise<boolean>;

function ticketKey(ticket: string): string {
  return `${WS_TICKET_PREFIX}${ticket}`;
}

function isTicket(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
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
    isUuidV4String(parsed.userId) &&
    hasStringProperty(parsed, "sessionId") &&
    isSessionId(parsed.sessionId)
  ) {
    return { sessionId: parsed.sessionId, userId: parsed.userId };
  }

  return null;
}

export async function issueWebSocketTicket(
  identity: WebSocketTicketIdentity,
): Promise<string> {
  if (!isUuidV4String(identity.userId) || !isSessionId(identity.sessionId)) {
    throw new Error("WebSocket ticket identity must reference a live session");
  }

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
  validateSession: WebSocketTicketSessionValidator = isLiveUserSession,
): Promise<WebSocketTicketIdentity | null> {
  if (!isTicket(ticket)) {
    return null;
  }

  const raw = await getdel(ticketKey(ticket));
  if (raw === null) {
    return null;
  }

  const identity = parseTicketIdentity(raw);
  if (!identity) {
    return null;
  }

  return (await validateSession(identity)) ? identity : null;
}

export function createWebSocketTicketConsumer(
  validateSession: WebSocketTicketSessionValidator,
): (ticket: string) => Promise<WebSocketTicketIdentity | null> {
  return (ticket) => consumeWebSocketTicket(ticket, validateSession);
}
