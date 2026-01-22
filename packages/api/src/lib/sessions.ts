import { isRecord } from '@rapid/shared';
import { getAccessTokenTtlSeconds } from './authConfig.js';
import { getRedisClient } from './redis.js';

type SessionData = {
  userId: string;
  email: string;
};

const SESSION_PREFIX = 'session';

const getSessionKey = (sessionId: string): string =>
  `${SESSION_PREFIX}:${sessionId}`;

export async function createSession(
  sessionId: string,
  data: SessionData,
  ttlSeconds: number = getAccessTokenTtlSeconds()
): Promise<void> {
  const client = await getRedisClient();
  const key = getSessionKey(sessionId);
  await client.set(key, JSON.stringify(data));
  await client.expire(key, ttlSeconds);
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

  if (typeof userId !== 'string' || typeof email !== 'string') {
    return null;
  }

  return { userId, email };
}
