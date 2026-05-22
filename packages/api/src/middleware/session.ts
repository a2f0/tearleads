import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import {
  del,
  expire,
  get,
  sadd,
  set,
  srem,
  sscanMembers,
} from "../adapters/redis";
import type { SessionCreateInput, SessionData } from "../validators/session";
import { isSessionData } from "../validators/session";

const SESSION_TTL_SECONDS = 86400;
const SESSION_ID_PREFIX = "session-id:";
const SESSION_PREFIX = "session:";
const USER_SESSIONS_PREFIX = "user-sessions:";

type SessionStoreAddSetMember = (key: string, member: string) => Promise<void>;
type SessionStoreDelete = (key: string) => Promise<void>;
type SessionStoreExpire = (key: string, ttlSeconds: number) => Promise<void>;
type SessionStoreGet = (key: string) => Promise<string | null>;
type SessionStoreRemoveSetMember = (
  key: string,
  member: string,
) => Promise<void>;
type SessionStoreScanSetMembers = (key: string) => AsyncIterable<string[]>;
type SessionStoreSet = (
  key: string,
  value: string,
  ttlSeconds?: number,
) => Promise<void>;

export interface SessionEnv {
  Variables: {
    session: SessionData;
    sessionToken: string;
  };
}

export interface UserSessionSummary {
  id: string;
  fingerprint: string;
  createdAt: number;
  isCurrent: boolean;
}

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

function sessionIdKey(sessionId: string): string {
  return `${SESSION_ID_PREFIX}${sessionId}`;
}

function userSessionsKey(userId: string): string {
  return `${USER_SESSIONS_PREFIX}${userId}`;
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

function parseSessionData(raw: string): SessionData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return isSessionData(parsed) ? parsed : null;
}

async function destroySessionToken(input: {
  deleteSession: SessionStoreDelete;
  getSession: SessionStoreGet;
  removeSetMember: SessionStoreRemoveSetMember;
  token: string;
}): Promise<void> {
  const sessionRaw = await input.getSession(sessionKey(input.token));
  await input.deleteSession(sessionKey(input.token));

  if (!sessionRaw) {
    return;
  }

  const session = parseSessionData(sessionRaw);
  if (!session) {
    return;
  }

  await input.deleteSession(sessionIdKey(session.id));
  await input.removeSetMember(userSessionsKey(session.userId), session.id);
}

export function createDestroySession(
  getSession: SessionStoreGet,
  deleteSession: SessionStoreDelete,
  removeSetMember: SessionStoreRemoveSetMember,
) {
  return async (c: Context): Promise<void> => {
    const token = extractToken(c);
    if (token) {
      await destroySessionToken({
        deleteSession,
        getSession,
        removeSetMember,
        token,
      });
    }
  };
}

export const destroySession = createDestroySession(get, del, srem);

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

      const parsed = parseSessionData(sessionRaw);

      if (!parsed) {
        return c.json({ error: "Invalid session data" }, 401);
      }

      c.set("session", parsed);
      c.set("sessionToken", token);

      return next();
    },
  );
}

export const requireAuth = createRequireAuth(get);

export function createListUserSessions(
  getSession: SessionStoreGet,
  removeSetMember: SessionStoreRemoveSetMember,
  scanSetMembers: SessionStoreScanSetMembers,
) {
  return async (input: {
    currentToken: string;
    userId: string;
  }): Promise<UserSessionSummary[]> => {
    const indexKey = userSessionsKey(input.userId);
    const summaries: UserSessionSummary[] = [];

    for await (const sessionIds of scanSetMembers(indexKey)) {
      const batchSummaries = await Promise.all(
        sessionIds.map(
          async (sessionId): Promise<UserSessionSummary | null> => {
            const token = await getSession(sessionIdKey(sessionId));
            if (!token) {
              await removeSetMember(indexKey, sessionId);
              return null;
            }

            const raw = await getSession(sessionKey(token));
            if (!raw) {
              await removeSetMember(indexKey, sessionId);
              return null;
            }

            const data = parseSessionData(raw);
            if (
              !data ||
              data.userId !== input.userId ||
              data.id !== sessionId
            ) {
              await removeSetMember(indexKey, sessionId);
              return null;
            }

            return {
              id: data.id,
              fingerprint: data.fingerprint,
              createdAt: data.createdAt,
              isCurrent: token === input.currentToken,
            };
          },
        ),
      );
      summaries.push(
        ...batchSummaries.filter(
          (summary): summary is UserSessionSummary => summary !== null,
        ),
      );
    }

    return summaries.sort((a, b) => b.createdAt - a.createdAt);
  };
}

export const listUserSessions = createListUserSessions(get, srem, sscanMembers);

export function createDestroyUserSession(
  getSession: SessionStoreGet,
  deleteSession: SessionStoreDelete,
  removeSetMember: SessionStoreRemoveSetMember,
) {
  return async (input: {
    sessionId: string;
    userId: string;
  }): Promise<boolean> => {
    const token = await getSession(sessionIdKey(input.sessionId));
    if (!token) {
      await removeSetMember(userSessionsKey(input.userId), input.sessionId);
      return false;
    }

    const raw = await getSession(sessionKey(token));
    if (!raw) {
      await deleteSession(sessionIdKey(input.sessionId));
      await removeSetMember(userSessionsKey(input.userId), input.sessionId);
      return false;
    }

    const data = parseSessionData(raw);
    if (!data) {
      await deleteSession(sessionIdKey(input.sessionId));
      await removeSetMember(userSessionsKey(input.userId), input.sessionId);
      return false;
    }

    if (data.userId !== input.userId || data.id !== input.sessionId) {
      return false;
    }

    await destroySessionToken({
      deleteSession,
      getSession,
      removeSetMember,
      token,
    });
    return true;
  };
}

export const destroyUserSession = createDestroyUserSession(get, del, srem);

export function createSessionTokenIssuer(
  setSession: SessionStoreSet,
  addSetMember: SessionStoreAddSetMember,
  expireKey: SessionStoreExpire,
) {
  return async (data: SessionCreateInput): Promise<string> => {
    const token = bytesToHex(generateChallenge(32));
    const session: SessionData = {
      ...data,
      id: bytesToHex(generateChallenge(32)),
    };

    await setSession(
      sessionKey(token),
      JSON.stringify(session),
      SESSION_TTL_SECONDS,
    );
    await setSession(sessionIdKey(session.id), token, SESSION_TTL_SECONDS);
    await addSetMember(userSessionsKey(session.userId), session.id);
    await expireKey(userSessionsKey(session.userId), SESSION_TTL_SECONDS);

    return token;
  };
}

export const createSession = createSessionTokenIssuer(set, sadd, expire);
