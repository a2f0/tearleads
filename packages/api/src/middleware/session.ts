import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { del, get, set } from "../adapters/redis";
import { isSessionData } from "../validators/session";

const SESSION_COOKIE_NAME = "session_id";
const SESSION_TTL_SECONDS = 86400;
const SESSION_PREFIX = "session:";

export interface SessionData {
  fingerprint: string;
  createdAt: number;
}

function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

export async function createSession(
  c: Context,
  data: SessionData,
): Promise<string> {
  const sessionId = bytesToHex(generateChallenge(32));

  await set(sessionKey(sessionId), JSON.stringify(data), SESSION_TTL_SECONDS);

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return sessionId;
}

export async function destroySession(c: Context): Promise<void> {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId) {
    await del(sessionKey(sessionId));
  }
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: "/",
  });
}

export const requireAuth = createMiddleware(async (c: Context, next: Next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);

  if (!sessionId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const sessionRaw = await get(sessionKey(sessionId));

  if (!sessionRaw) {
    return c.json({ error: "Session expired" }, 401);
  }

  const parsed: unknown = JSON.parse(sessionRaw);

  if (!isSessionData(parsed)) {
    return c.json({ error: "Invalid session data" }, 401);
  }

  c.set("session", parsed);

  return next();
});
