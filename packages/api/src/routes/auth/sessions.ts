import {
  destroySessionOperation,
  listSessionsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  DestroySessionResponse,
  ListSessionsResponse,
  UserSessionResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv, UserSessionSummary } from "../../middleware/session";
import { pathParamsValidator } from "../../validators/pathParams";

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
    ipAddresses: session.ipAddresses,
    isCurrent: session.isCurrent,
    lastActiveAt: new Date(session.lastActiveAt).toISOString(),
    lastActiveIp: session.lastActiveIp,
    signingKeyFingerprint: session.fingerprint,
  };
}

export function createSessionsRoute({
  destroyUserSession,
  listUserSessions,
  requireAuth,
}: SessionsRouteDeps) {
  const sessionsRoute = new Hono<SessionEnv>();

  sessionsRoute.on(
    listSessionsOperation.method,
    operationRoutePath(listSessionsOperation),
    requireAuth,
    async (c) => {
      const session = c.get("session");
      const currentToken = c.get("sessionToken");
      const sessions = await listUserSessions({
        currentToken,
        userId: session.userId,
      });

      return c.json<ListSessionsResponse>({
        sessions: sessions.map(toSessionResponse),
      });
    },
  );

  sessionsRoute.on(
    destroySessionOperation.method,
    operationRoutePath(destroySessionOperation),
    requireAuth,
    pathParamsValidator(destroySessionOperation.params, "Invalid session id"),
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const destroyed = await destroyUserSession({
        sessionId,
        userId: c.get("session").userId,
      });

      if (!destroyed) {
        return c.json({ error: "Session not found" }, 404);
      }

      return c.json<DestroySessionResponse>({ message: "ok" });
    },
  );

  return sessionsRoute;
}
