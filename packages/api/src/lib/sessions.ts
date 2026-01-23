import { isRecord } from '@rapid/shared';
import { getAccessTokenTtlSeconds } from './authConfig.js';
import { getRedisClient } from './redis.js';

export type SessionData = {
  userId: string;
  email: string;
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
  await client.expire(userSessionsKey, ttlSeconds);
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

  if (
    typeof userId !== 'string' ||
    typeof email !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof lastActiveAt !== 'string' ||
    typeof ipAddress !== 'string'
  ) {
    return null;
  }

  return { userId, email, createdAt, lastActiveAt, ipAddress };
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
