import { isRecord } from '@tearleads/shared';
import { getRedisClient } from '@tearleads/shared/redis';
import {
  getAccessTokenTtlSeconds,
  getRefreshTokenTtlSeconds
} from './authConfig.js';

export type SessionData = {
  userId: string;
  email: string;
  admin: boolean;
  createdAt: string;
  lastActiveAt: string;
  ipAddress: string;
};

const SESSION_PREFIX = 'session';
const USER_SESSIONS_PREFIX = 'user_sessions';

const getSessionKey = (sessionId: string): string =>
  `${SESSION_PREFIX}:${sessionId}`;

const getUserSessionsKey = (userId: string): string =>
  `${USER_SESSIONS_PREFIX}:${userId}`;

export async function createSession(
  sessionId: string,
  data: Omit<SessionData, 'createdAt' | 'lastActiveAt'>,
  ttlSeconds: number = getAccessTokenTtlSeconds()
): Promise<void> {
  const client = await getRedisClient();
  const key = getSessionKey(sessionId);
  const userSessionsKey = getUserSessionsKey(data.userId);
  const now = new Date().toISOString();

  const sessionData: SessionData = {
    ...data,
    createdAt: now,
    lastActiveAt: now
  };

  await client.set(key, JSON.stringify(sessionData), { EX: ttlSeconds });
  await client.sAdd(userSessionsKey, sessionId);
  await client.expire(userSessionsKey, getRefreshTokenTtlSeconds());
}

export async function getSession(
  sessionId: string
): Promise<SessionData | null> {
  const client = await getRedisClient();
  const key = getSessionKey(sessionId);
  const raw = await client.get(key);
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const userId = parsed['userId'];
  const email = parsed['email'];
  const createdAt = parsed['createdAt'];
  const lastActiveAt = parsed['lastActiveAt'];
  const ipAddress = parsed['ipAddress'];
  const admin = parsed['admin'];

  if (
    typeof userId !== 'string' ||
    typeof email !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof lastActiveAt !== 'string' ||
    typeof ipAddress !== 'string'
  ) {
    return null;
  }

  if (admin !== undefined && typeof admin !== 'boolean') {
    return null;
  }

  return {
    userId,
    email,
    admin: typeof admin === 'boolean' ? admin : false,
    createdAt,
    lastActiveAt,
    ipAddress
  };
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  try {
    const client = await getRedisClient();
    const key = getSessionKey(sessionId);
    const raw = await client.get(key);
    if (!raw) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isRecord(parsed)) {
      return;
    }

    const ttl = await client.ttl(key);
    if (ttl <= 0) {
      return;
    }

    const updated = {
      ...parsed,
      lastActiveAt: new Date().toISOString()
    };

    await client.set(key, JSON.stringify(updated), { EX: ttl });
  } catch {
    // Silently ignore errors - this is a fire-and-forget operation
    // that shouldn't affect the request if it fails
  }
}

export async function getSessionsByUserId(
  userId: string
): Promise<Array<SessionData & { id: string }>> {
  const client = await getRedisClient();
  const userSessionsKey = getUserSessionsKey(userId);

  const sessionIds = await client.sMembers(userSessionsKey);
  const sessions: Array<SessionData & { id: string }> = [];

  for (const sessionId of sessionIds) {
    const session = await getSession(sessionId);
    if (session && session.userId === userId) {
      sessions.push({ ...session, id: sessionId });
    } else {
      await client.sRem(userSessionsKey, sessionId);
    }
  }

  return sessions;
}

export async function getLatestLastActiveByUserIds(
  userIds: string[]
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  for (const userId of userIds) {
    results[userId] = null;
  }
  if (userIds.length === 0) {
    return results;
  }

  try {
    const client = await getRedisClient();
    const multi = client.multi();
    for (const userId of userIds) {
      multi.sMembers(getUserSessionsKey(userId));
    }

    const sessionSets = await multi.exec();
    if (!sessionSets) {
      return results;
    }

    const sessionIdToUser = new Map<string, string>();
    for (const [index, rawSessions] of sessionSets.entries()) {
      const userId = userIds[index];
      if (!userId) {
        continue;
      }
      if (!Array.isArray(rawSessions)) {
        continue;
      }
      for (const sessionId of rawSessions) {
        if (typeof sessionId === 'string') {
          sessionIdToUser.set(sessionId, userId);
        }
      }
    }

    const sessionIds = Array.from(sessionIdToUser.keys());
    if (sessionIds.length === 0) {
      return results;
    }

    const sessionKeys = sessionIds.map(getSessionKey);
    const rawSessions = await client.mGet(sessionKeys);
    const latestByUser = new Map<
      string,
      { timestamp: number; value: string }
    >();

    for (const [index, raw] of rawSessions.entries()) {
      if (!raw) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      if (!isRecord(parsed)) {
        continue;
      }

      const userId = parsed['userId'];
      const lastActiveAt = parsed['lastActiveAt'];
      if (typeof userId !== 'string' || typeof lastActiveAt !== 'string') {
        continue;
      }

      const sessionId = sessionIds[index];
      if (!sessionId) {
        continue;
      }

      const expectedUserId = sessionIdToUser.get(sessionId);
      if (!expectedUserId || expectedUserId !== userId) {
        continue;
      }

      const timestamp = Date.parse(lastActiveAt);
      if (Number.isNaN(timestamp)) {
        continue;
      }

      const current = latestByUser.get(userId);
      if (!current || timestamp > current.timestamp) {
        latestByUser.set(userId, { timestamp, value: lastActiveAt });
      }
    }

    for (const userId of userIds) {
      results[userId] = latestByUser.get(userId)?.value ?? null;
    }

    return results;
  } catch (err) {
    console.error('Failed to get latest session activity:', err);
    return results;
  }
}

export async function deleteSession(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const client = await getRedisClient();
  const key = getSessionKey(sessionId);
  const userSessionsKey = getUserSessionsKey(userId);

  const session = await getSession(sessionId);
  if (!session || session.userId !== userId) {
    return false;
  }

  await client.del(key);
  await client.sRem(userSessionsKey, sessionId);

  return true;
}

// Refresh token storage
const REFRESH_TOKEN_PREFIX = 'refresh_token';

const getRefreshTokenKey = (tokenId: string): string =>
  `${REFRESH_TOKEN_PREFIX}:${tokenId}`;

export type RefreshTokenData = {
  sessionId: string;
  userId: string;
  createdAt: string;
};

export async function storeRefreshToken(
  tokenId: string,
  data: Omit<RefreshTokenData, 'createdAt'>,
  ttlSeconds: number
): Promise<void> {
  const client = await getRedisClient();
  const key = getRefreshTokenKey(tokenId);
  const tokenData: RefreshTokenData = {
    ...data,
    createdAt: new Date().toISOString()
  };
  await client.set(key, JSON.stringify(tokenData), { EX: ttlSeconds });
}

export async function getRefreshToken(
  tokenId: string
): Promise<RefreshTokenData | null> {
  const client = await getRedisClient();
  const key = getRefreshTokenKey(tokenId);
  const raw = await client.get(key);
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const sessionId = parsed['sessionId'];
  const userId = parsed['userId'];
  const createdAt = parsed['createdAt'];

  if (
    typeof sessionId !== 'string' ||
    typeof userId !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }

  return { sessionId, userId, createdAt };
}

export async function deleteRefreshToken(tokenId: string): Promise<void> {
  const client = await getRedisClient();
  const key = getRefreshTokenKey(tokenId);
  await client.del(key);
}

export type TokenRotationParams = {
  oldRefreshTokenId: string;
  oldSessionId: string;
  newSessionId: string;
  newRefreshTokenId: string;
  sessionData: Omit<SessionData, 'createdAt' | 'lastActiveAt'>;
  sessionTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /** Original session creation time to preserve across token rotations */
  originalCreatedAt?: string;
};

export async function rotateTokensAtomically(
  params: TokenRotationParams
): Promise<void> {
  const client = await getRedisClient();
  const now = new Date().toISOString();

  const oldRefreshTokenKey = getRefreshTokenKey(params.oldRefreshTokenId);
  const oldSessionKey = getSessionKey(params.oldSessionId);
  const newSessionKey = getSessionKey(params.newSessionId);
  const newRefreshTokenKey = getRefreshTokenKey(params.newRefreshTokenId);
  const userSessionsKey = getUserSessionsKey(params.sessionData.userId);

  const newSessionData: SessionData = {
    ...params.sessionData,
    createdAt: params.originalCreatedAt ?? now,
    lastActiveAt: now
  };

  const newRefreshTokenData: RefreshTokenData = {
    sessionId: params.newSessionId,
    userId: params.sessionData.userId,
    createdAt: now
  };

  const multi = client.multi();
  multi.del(oldRefreshTokenKey);
  multi.del(oldSessionKey);
  multi.sRem(userSessionsKey, params.oldSessionId);
  multi.set(newSessionKey, JSON.stringify(newSessionData), {
    EX: params.sessionTtlSeconds
  });
  multi.set(newRefreshTokenKey, JSON.stringify(newRefreshTokenData), {
    EX: params.refreshTokenTtlSeconds
  });
  multi.sAdd(userSessionsKey, params.newSessionId);
  multi.expire(userSessionsKey, params.refreshTokenTtlSeconds);

  await multi.exec();
}

/**
 * Delete all sessions for a user. Used when disabling an account.
 * Also deletes associated refresh tokens.
 * @returns The number of sessions deleted
 */
export async function deleteAllSessionsForUser(
  userId: string
): Promise<number> {
  const client = await getRedisClient();
  const userSessionsKey = getUserSessionsKey(userId);

  const sessionIds = await client.sMembers(userSessionsKey);
  if (sessionIds.length === 0) {
    return 0;
  }

  const multi = client.multi();

  for (const sessionId of sessionIds) {
    multi.del(getSessionKey(sessionId));
    multi.del(getRefreshTokenKey(sessionId));
  }

  multi.del(userSessionsKey);

  await multi.exec();

  return sessionIds.length;
}
