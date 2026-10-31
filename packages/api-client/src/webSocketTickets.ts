import { webSocketTicketOperation } from "@tearleads/validators/operation";
import { WS_TICKET_TTL_SECONDS } from "@tearleads/validators/realtime";
import type { VerifySuccessResponse } from "@tearleads/validators/response";
import type { OperationTransport } from "./operationTransportFactory";

/**
 * A login ticket is handed out only within half the server's ticket lifetime,
 * measured on this client's clock from when the login response arrived.
 */
const LOGIN_TICKET_MAX_AGE_MS = (WS_TICKET_TTL_SECONDS * 1000) / 2;

interface LoginTicket {
  readonly expiresAt: number;
  readonly ticket: string;
  readonly token: string;
}

/**
 * Single-use websocket upgrade tickets. `POST /auth/verify` returns the new
 * session's first ticket, so the first connect after login needs no
 * `POST /auth/ws-ticket`. That ticket is handed out at most once, and only
 * while the session it was issued for is still the client's current one; every
 * other connect mints a fresh ticket.
 */
export class WebSocketTickets {
  private loginTicket: LoginTicket | null = null;

  constructor(
    private readonly transport: Pick<OperationTransport, "request">,
    private readonly currentToken: () => string | null,
    private readonly now: () => number = Date.now,
  ) {}

  rememberLogin(login: VerifySuccessResponse): void {
    this.loginTicket = {
      expiresAt: this.now() + LOGIN_TICKET_MAX_AGE_MS,
      ticket: login.wsTicket,
      token: login.token,
    };
  }

  async next(): Promise<string | null> {
    const login = this.loginTicket;
    this.loginTicket = null;
    if (
      login &&
      login.token === this.currentToken() &&
      this.now() < login.expiresAt
    )
      return login.ticket;
    const response = await this.transport.request(webSocketTicketOperation, {
      params: {},
    });
    return response?.ticket ?? null;
  }
}

/**
 * Opens the API's server-events socket with a ticket from
 * {@link WebSocketTickets.next}. The handshake cannot carry the bearer header,
 * so the single-use ticket rides in the query; it replaces any `ticket` the
 * configured URL already has and keeps the URL's other parameters.
 */
export function openServerEventsSocket(
  wsUrl: string,
  ticket: string,
  createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
): WebSocket {
  const url = new URL(wsUrl);
  url.searchParams.set("ticket", ticket);
  return createSocket(url.toString());
}
