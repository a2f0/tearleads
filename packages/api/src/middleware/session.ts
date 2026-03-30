import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { del, get, set } from "../adapters/redis";
import type { SessionData } from "../validators/session";
import { isSessionData } from "../validators/session";

const SESSION_TTL_SECONDS = 86400;
const SESSION_PREFIX = "session:";

interface SessionEnv {
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

export async function createSession(data: SessionData): Promise<string> {
  const token = bytesToHex(generateChallenge(32));

  await set(sessionKey(token), JSON.stringify(data), SESSION_TTL_SECONDS);

  return token;
}

export async function destroySession(c: Context): Promise<void> {
  const token = extractToken(c);
  if (token) {
    await del(sessionKey(token));
  }
}

export const requireAuth = createMiddleware<SessionEnv>(
  async (c: Context<SessionEnv>, next: Next) => {
    const token = extractToken(c);

    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const sessionRaw = await get(sessionKey(token));

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
