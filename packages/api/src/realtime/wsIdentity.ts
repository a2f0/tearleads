export interface WebSocketTicketIdentity {
  readonly userId: string;
  readonly sessionId: string;
}

/** Whether a socket's session is still live in the session store. */
export type WsSessionValidator = (
  identity: WebSocketTicketIdentity,
) => Promise<boolean>;
