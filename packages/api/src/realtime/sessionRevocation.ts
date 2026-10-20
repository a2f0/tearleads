import { publish } from "../adapters/pubSub";
import type { SessionData } from "../validators/session";
import type { PublishedRealtimeEvent } from "./publishedRealtimeEvents";

const SESSION_REVOKED_EVENT_TYPE = "session_revoked";

type SessionRevokedEvent = Extract<
  PublishedRealtimeEvent,
  { type: typeof SESSION_REVOKED_EVENT_TYPE }
>;

function sessionRevokedEvent(session: SessionData): SessionRevokedEvent {
  return {
    sessionId: session.id,
    type: SESSION_REVOKED_EVENT_TYPE,
    userId: session.userId,
  };
}

interface SessionRevocationNotifierDependencies {
  publishEvent: (event: SessionRevokedEvent) => Promise<void>;
}

/**
 * Closes the revoked session's open sockets. No interest outlives a socket,
 * so revocation has nothing else to clear.
 */
export function createSessionRevocationNotifier({
  publishEvent,
}: SessionRevocationNotifierDependencies) {
  return (session: SessionData): Promise<void> =>
    publishEvent(sessionRevokedEvent(session));
}

export const notifySessionRevoked = createSessionRevocationNotifier({
  publishEvent: publish,
});
