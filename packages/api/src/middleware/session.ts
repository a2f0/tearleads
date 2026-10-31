import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import {
  del,
  expire,
  get,
  sadd,
  set,
  setKeepTtl,
  srem,
  sscanMembers,
} from "../adapters/keyValueStore";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { notifySessionRevoked } from "../realtime/sessionRevocation";
import { withPrincipalHistoryRequest } from "../utils/principalHistoryWork";
import type { SessionCreateInput, SessionData } from "../validators/session";
import { isSessionData, isSessionId } from "../validators/session";
import {
  normalizeRequestIpAddress,
  type RouteRequestBindings,
  readRequestIpAddress,
} from "./requestIp";
import type { RequestLifetimeBindings } from "./requestLifetime";
import {
  persistSessionActivity,
  shouldUpdateSessionActivity,
  withSessionActivity,
} from "./sessionActivity";
import {
  recordActivityUnlessSuspended as defaultRecordActivityUnlessSuspended,
  recordUserActivity as defaultRecordUserActivity,
  type UserActivityRecorder,
  type UserActivityStandingRecorder,
} from "./userActivity";
import {
  isUserSuspended as defaultIsUserSuspended,
  type UserSuspensionCheck,
} from "./userSuspension";

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
type SessionStoreSetKeepTtl = (key: string, value: string) => Promise<void>;
type SessionRevocationNotifier = (session: SessionData) => Promise<void>;

export type { RouteRequestBindings } from "./requestIp";

export interface SessionEnv {
  Bindings: RouteRequestBindings & RequestLifetimeBindings;
  Variables: {
    session: SessionData;
    sessionToken: string;
  };
}

export interface UserSessionSummary {
  id: string;
  fingerprint: string;
  createdAt: number;
  ipAddresses: string[];
  isCurrent: boolean;
  lastActiveAt: number;
  lastActiveIp: string | null;
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
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice(7);
  return isSessionId(token) ? token : null;
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
  notifyRevoked: SessionRevocationNotifier | undefined;
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
  if (input.notifyRevoked) {
    try {
      await input.notifyRevoked(session);
    } catch (error) {
      // The session rows are already gone; a failed fan-out must not resurrect
      // them or fail the logout, so the report rides alongside the log.
      console.error("Failed to notify session revocation:", error);
      reportBackgroundFailure(error, "session.revoke");
    }
  }
}

export function createDestroySession(
  getSession: SessionStoreGet,
  deleteSession: SessionStoreDelete,
  removeSetMember: SessionStoreRemoveSetMember,
  notifyRevoked?: SessionRevocationNotifier,
) {
  return async (c: Context): Promise<void> => {
    const token = extractToken(c);
    if (token) {
      await destroySessionToken({
        deleteSession,
        getSession,
        notifyRevoked,
        removeSetMember,
        token,
      });
    }
  };
}

export const destroySession = createDestroySession(
  get,
  del,
  srem,
  notifySessionRevoked,
);

export function createRequireAuth(
  getSession: SessionStoreGet,
  setSessionKeepTtl: SessionStoreSetKeepTtl,
  recordActivityUnlessSuspended?: UserActivityStandingRecorder,
) {
  return createMiddleware<SessionEnv>(
    async (c: Context<SessionEnv>, next: Next) => {
      const token = extractToken(c);

      if (!token) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const sessionRaw = await getSession(sessionKey(token));

      if (!sessionRaw) {
        return c.json(
          {
            code: SESSION_ERROR_CODES.refreshRequired,
            error: "Session expired",
          },
          401,
        );
      }

      const parsed = parseSessionData(sessionRaw);

      if (!parsed) {
        return c.json(
          {
            code: SESSION_ERROR_CODES.refreshRequired,
            error: "Invalid session data",
          },
          401,
        );
      }

      const ipAddress = readRequestIpAddress(c);
      const now = Date.now();
      const shouldUpdateActivity = shouldUpdateSessionActivity(
        parsed,
        ipAddress,
        now,
      );
      const session = shouldUpdateActivity
        ? withSessionActivity(parsed, ipAddress, now)
        : parsed;

      // One statement checks standing and stamps `users.last_active_at`.
      // Refused before session activity advances, so every later request
      // re-checks. A failed statement fails the request: suspension
      // enforcement is closed.
      if (
        shouldUpdateActivity &&
        recordActivityUnlessSuspended &&
        (await recordActivityUnlessSuspended({
          lastActiveAt: now,
          userId: session.userId,
        }))
      ) {
        return c.json(
          {
            code: SESSION_ERROR_CODES.refreshRequired,
            error: "Account suspended",
          },
          401,
        );
      }
      if (shouldUpdateActivity) {
        await persistSessionActivity({
          key: sessionKey(token),
          session,
          setSessionKeepTtl,
        });
      }

      c.set("session", session);
      c.set("sessionToken", token);

      return withPrincipalHistoryRequest(
        c.env?.beginPrincipalHistoryVerification,
        next,
      );
    },
  );
}

export const requireAuth = createRequireAuth(
  get,
  setKeepTtl,
  defaultRecordActivityUnlessSuspended,
);

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
              ipAddresses: data.ipAddresses,
              isCurrent: token === input.currentToken,
              lastActiveAt: data.lastActiveAt,
              lastActiveIp: data.lastActiveIp,
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

    return summaries.sort(
      (a, b) => b.lastActiveAt - a.lastActiveAt || b.createdAt - a.createdAt,
    );
  };
}

export const listUserSessions = createListUserSessions(get, srem, sscanMembers);

/**
 * Whether a websocket's session may stay open: still stored and, when a
 * standing check is given, its user not suspended, so a socket a suspension's
 * sweep missed closes on its next liveness check.
 */
export function createIsLiveUserSession(
  getSession: SessionStoreGet,
  isUserSuspended?: UserSuspensionCheck,
) {
  return async (input: {
    sessionId: string;
    userId: string;
  }): Promise<boolean> => {
    const token = await getSession(sessionIdKey(input.sessionId));
    if (!token) {
      return false;
    }

    const raw = await getSession(sessionKey(token));
    if (!raw) {
      return false;
    }

    const data = parseSessionData(raw);
    if (data?.id !== input.sessionId || data.userId !== input.userId) {
      return false;
    }
    return !(await isUserSuspended?.(input.userId));
  };
}

export const isLiveUserSession = createIsLiveUserSession(
  get,
  defaultIsUserSuspended,
);

export function createDestroyUserSession(
  getSession: SessionStoreGet,
  deleteSession: SessionStoreDelete,
  removeSetMember: SessionStoreRemoveSetMember,
  notifyRevoked?: SessionRevocationNotifier,
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
      notifyRevoked,
      removeSetMember,
      token,
    });
    return true;
  };
}

export const destroyUserSession = createDestroyUserSession(
  get,
  del,
  srem,
  notifySessionRevoked,
);

/** A newly stored session: its bearer token and the session's own id. */
export interface IssuedSession {
  readonly sessionId: string;
  readonly token: string;
}

export function createSessionTokenIssuer(
  setSession: SessionStoreSet,
  addSetMember: SessionStoreAddSetMember,
  expireKey: SessionStoreExpire,
  recordUserActivity?: UserActivityRecorder,
) {
  return async (data: SessionCreateInput): Promise<IssuedSession> => {
    const token = bytesToHex(generateChallenge(32));
    const ipAddress = normalizeRequestIpAddress(data.ipAddress);
    const session: SessionData = {
      createdAt: data.createdAt,
      fingerprint: data.fingerprint,
      id: bytesToHex(generateChallenge(32)),
      ipAddresses: ipAddress ? [ipAddress] : [],
      lastActiveAt: data.createdAt,
      lastActiveIp: ipAddress,
      userId: data.userId,
    };

    await setSession(
      sessionKey(token),
      JSON.stringify(session),
      SESSION_TTL_SECONDS,
    );
    await setSession(sessionIdKey(session.id), token, SESSION_TTL_SECONDS);
    await addSetMember(userSessionsKey(session.userId), session.id);
    await expireKey(userSessionsKey(session.userId), SESSION_TTL_SECONDS);

    // Login is itself activity; without this a user seen only within the
    // throttle window after logging in would have no last_active_at at all.
    if (recordUserActivity) {
      try {
        await recordUserActivity({
          lastActiveAt: session.createdAt,
          userId: session.userId,
        });
      } catch (error) {
        console.error("Failed to record login activity:", error);
      }
    }

    return { sessionId: session.id, token };
  };
}

export const createSession = createSessionTokenIssuer(
  set,
  sadd,
  expire,
  defaultRecordUserActivity,
);
