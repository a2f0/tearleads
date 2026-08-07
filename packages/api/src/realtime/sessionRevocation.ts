import { publish } from "../adapters/redisPubSub";
import type { SessionData } from "../validators/session";
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

interface SessionRevocationNotifierDependencies {
  clearInterest: (userId: string, sessionId: string) => Promise<void>;
  onClearInterestError?: (error: unknown) => void;
  publishEvent: (event: SessionRevokedEvent) => Promise<void>;
}

export function createSessionRevocationNotifier({
  clearInterest,
  onClearInterestError = (error) => {
    console.error("Failed to clear websocket interest store:", error);
  },
  publishEvent,
}: SessionRevocationNotifierDependencies) {
  return async (session: SessionData): Promise<void> => {
    const clearInterestTask = Promise.resolve()
      .then(() => clearInterest(session.userId, session.id))
      .catch(onClearInterestError);
    const publishTask = Promise.resolve().then(() =>
      publishEvent(sessionRevokedEvent(session)),
    );

    await Promise.all([clearInterestTask, publishTask]);
  };
}

export const notifySessionRevoked = createSessionRevocationNotifier({
  clearInterest: (userId, sessionId) =>
    wsInterestStore.clear(userId, sessionId),
  publishEvent: publish,
});
