import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionStore = new Map<string, string>();
const userSessionsStore = new Map<string, Set<string>>();
const sessionTtl = new Map<string, number>();

const mockGet = vi.fn((key: string) => {
  return Promise.resolve(sessionStore.get(key) ?? null);
});
const mockSet = vi.fn(
  (key: string, value: string, options?: { EX?: number }) => {
    sessionStore.set(key, value);
    if (options?.EX) {
      sessionTtl.set(key, options.EX);
    }
    return Promise.resolve('OK');
  }
);
const mockDel = vi.fn((key: string) => {
  const existed = sessionStore.delete(key);
  sessionTtl.delete(key);
  return Promise.resolve(existed ? 1 : 0);
});
const mockExpire = vi.fn((key: string, seconds: number) => {
  sessionTtl.set(key, seconds);
  return Promise.resolve(1);
});
const mockTtl = vi.fn((key: string) => {
  return Promise.resolve(sessionTtl.get(key) ?? -2);
});
const mockSAdd = vi.fn((key: string, member: string) => {
  if (!userSessionsStore.has(key)) {
    userSessionsStore.set(key, new Set());
  }
  userSessionsStore.get(key)?.add(member);
  return Promise.resolve(1);
});
const mockSRem = vi.fn((key: string, member: string) => {
  const set = userSessionsStore.get(key);
  if (set?.delete(member)) {
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
});
const mockSMembers = vi.fn((key: string) => {
  const set = userSessionsStore.get(key);
  return Promise.resolve(set ? Array.from(set) : []);
});

vi.mock('./redis.js', () => ({
  getRedisClient: vi.fn(() =>
    Promise.resolve({
      get: mockGet,
      set: mockSet,
      del: mockDel,
      expire: mockExpire,
      ttl: mockTtl,
      sAdd: mockSAdd,
      sRem: mockSRem,
      sMembers: mockSMembers
    })
  )
}));

describe('sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    userSessionsStore.clear();
    sessionTtl.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('updateSessionActivity', () => {
    it('handles invalid JSON in session data', async () => {
      const { updateSessionActivity } = await import('./sessions.js');

      sessionStore.set('session:invalid-json', 'not valid json {{{');
      sessionTtl.set('session:invalid-json', 3600);

      await updateSessionActivity('invalid-json');

      expect(sessionStore.get('session:invalid-json')).toBe(
        'not valid json {{{'
      );
    });

    it('handles non-object session data', async () => {
      const { updateSessionActivity } = await import('./sessions.js');

      sessionStore.set('session:not-object', JSON.stringify('just a string'));
      sessionTtl.set('session:not-object', 3600);

      await updateSessionActivity('not-object');

      expect(sessionStore.get('session:not-object')).toBe(
        JSON.stringify('just a string')
      );
    });

    it('handles session with no TTL', async () => {
      const { updateSessionActivity } = await import('./sessions.js');

      const sessionData = {
        userId: 'user-1',
        email: 'test@example.com',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '127.0.0.1'
      };
      sessionStore.set('session:no-ttl', JSON.stringify(sessionData));

      await updateSessionActivity('no-ttl');

      const stored = sessionStore.get('session:no-ttl');
      expect(stored).toBe(JSON.stringify(sessionData));
    });
  });

  describe('getSessionsByUserId', () => {
    it('removes stale session IDs from user sessions set', async () => {
      const { getSessionsByUserId, createSession } = await import(
        './sessions.js'
      );

      await createSession('valid-session', {
        userId: 'user-cleanup',
        email: 'test@example.com',
        ipAddress: '127.0.0.1'
      });

      userSessionsStore.get('user_sessions:user-cleanup')?.add('stale-session');

      const sessions = await getSessionsByUserId('user-cleanup');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe('valid-session');

      expect(mockSRem).toHaveBeenCalledWith(
        'user_sessions:user-cleanup',
        'stale-session'
      );
    });
  });

  describe('getSession (parseSessionData)', () => {
    it('returns null for invalid JSON', async () => {
      const { getSession } = await import('./sessions.js');

      sessionStore.set('session:parse-invalid-json', 'not valid json {{{');

      const result = await getSession('parse-invalid-json');

      expect(result).toBeNull();
    });

    it('returns null for non-object data', async () => {
      const { getSession } = await import('./sessions.js');

      sessionStore.set(
        'session:parse-non-object',
        JSON.stringify('just a string')
      );

      const result = await getSession('parse-non-object');

      expect(result).toBeNull();
    });

    it('returns null when required fields are missing', async () => {
      const { getSession } = await import('./sessions.js');

      sessionStore.set(
        'session:parse-missing-fields',
        JSON.stringify({ userId: 'user-1' })
      );

      const result = await getSession('parse-missing-fields');

      expect(result).toBeNull();
    });

    it('returns null when session does not exist', async () => {
      const { getSession } = await import('./sessions.js');

      const result = await getSession('nonexistent-session');

      expect(result).toBeNull();
    });
  });

  describe('updateSessionActivity edge cases', () => {
    it('returns early when session does not exist', async () => {
      const { updateSessionActivity } = await import('./sessions.js');

      await updateSessionActivity('nonexistent-session-update');

      expect(mockSet).not.toHaveBeenCalled();
    });
  });
});
