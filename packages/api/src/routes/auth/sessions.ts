import type {
  DestroySessionResponse,
  ListSessionsResponse,
  UserSessionResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv, UserSessionSummary } from "../../middleware/session";

export interface SessionsRouteDeps {
  readonly destroyUserSession: (input: {
    sessionId: string;
    userId: string;
  }) => Promise<boolean>;
  readonly listUserSessions: (input: {
    currentToken: string;
    userId: string;
  }) => Promise<UserSessionSummary[]>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
}

function toSessionResponse(session: UserSessionSummary): UserSessionResponse {
  return {
    id: session.id,
    createdAt: new Date(session.createdAt).toISOString(),
    isCurrent: session.isCurrent,
    signingKeyFingerprint: session.fingerprint,
  };
}

function isSessionId(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function createSessionsRoute({
  destroyUserSession,
  listUserSessions,
  requireAuth,
}: SessionsRouteDeps) {
  const sessionsRoute = new Hono<SessionEnv>();

  sessionsRoute.get("/auth/sessions", requireAuth, async (c) => {
    const session = c.get("session");
    const currentToken = c.get("sessionToken");
    const sessions = await listUserSessions({
      currentToken,
      userId: session.userId,
    });

    return c.json<ListSessionsResponse>({
      sessions: sessions.map(toSessionResponse),
    });
  });

  sessionsRoute.delete("/auth/sessions/:sessionId", requireAuth, async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!isSessionId(sessionId)) {
      return c.json({ error: "Invalid session id" }, 400);
    }

    const destroyed = await destroyUserSession({
      sessionId,
      userId: c.get("session").userId,
    });

    if (!destroyed) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json<DestroySessionResponse>({ message: "ok" });
  });

  return sessionsRoute;
}
