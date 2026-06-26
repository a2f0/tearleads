import { publish } from "./adapters/redisPubSub";
import type { SessionData } from "./validators/session";
import { wsInterestStore } from "./wsInterestStore";

const SESSION_REVOKED_EVENT_TYPE = "session_revoked";

interface SessionRevokedEvent extends Record<string, unknown> {
  readonly type: typeof SESSION_REVOKED_EVENT_TYPE;
  readonly sessionId: string;
  readonly userId: string;
}

function sessionRevokedEvent(session: SessionData): SessionRevokedEvent {
  return {
    sessionId: session.id,
    type: SESSION_REVOKED_EVENT_TYPE,
    userId: session.userId,
  };
}

export async function notifySessionRevoked(
  session: SessionData,
): Promise<void> {
  await wsInterestStore.clear(session.userId, session.id);
  await publish(sessionRevokedEvent(session));
}
