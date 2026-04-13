import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { del, get, set } from "../adapters/redis";
import type { SessionData } from "../validators/session";
import { isSessionData } from "../validators/session";

const SESSION_TTL_SECONDS = 86400;
const SESSION_PREFIX = "session:";

type SessionStoreDelete = (key: string) => Promise<void>;
type SessionStoreGet = (key: string) => Promise<string | null>;
type SessionStoreSet = (
  key: string,
  value: string,
  ttlSeconds?: number,
) => Promise<void>;

export interface SessionEnv {
  Variables: {
    session: SessionData;
  };
}

function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

function extractToken(c: Context): string | null {
  // Authorization is canonical way to send credentials to a server (RFC 7235).
  const header = c.req.header("Authorization");
  // Bearer is the standard token scheme (RFC 7235).
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7);
}

export function createDestroySession(deleteSession: SessionStoreDelete) {
  return async (c: Context): Promise<void> => {
    const token = extractToken(c);
    if (token) {
      await deleteSession(sessionKey(token));
    }
  };
}

export const destroySession = createDestroySession(del);

export function createRequireAuth(getSession: SessionStoreGet) {
  return createMiddleware<SessionEnv>(
    async (c: Context<SessionEnv>, next: Next) => {
      const token = extractToken(c);

      if (!token) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const sessionRaw = await getSession(sessionKey(token));

      if (!sessionRaw) {
        return c.json({ error: "Session expired" }, 401);
      }

      const parsed: unknown = JSON.parse(sessionRaw);

      if (!isSessionData(parsed)) {
        return c.json({ error: "Invalid session data" }, 401);
      }

      c.set("session", parsed);

      return next();
    },
  );
}

export const requireAuth = createRequireAuth(get);

export function createSessionTokenIssuer(setSession: SessionStoreSet) {
  return async (data: SessionData): Promise<string> => {
    const token = bytesToHex(generateChallenge(32));

    await setSession(
      sessionKey(token),
      JSON.stringify(data),
      SESSION_TTL_SECONDS,
    );

    return token;
  };
}

export const createSession = createSessionTokenIssuer(set);
