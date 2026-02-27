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
const mockMGet = vi.fn((keys: string[]) => {
  return Promise.resolve(keys.map((key) => sessionStore.get(key) ?? null));
});

const createMockMulti = () => {
  type MultiCommand = () => Promise<unknown>;
  const commands: MultiCommand[] = [];
  const chain = {
    del: (key: string) => {
      commands.push(() => Promise.resolve(mockDel(key)));
      return chain;
    },
    set: (key: string, value: string, options?: { EX?: number }) => {
      commands.push(() => Promise.resolve(mockSet(key, value, options)));
      return chain;
    },
    sAdd: (key: string, member: string) => {
      commands.push(() => Promise.resolve(mockSAdd(key, member)));
      return chain;
    },
    sRem: (key: string, member: string) => {
      commands.push(() => Promise.resolve(mockSRem(key, member)));
      return chain;
    },
    sMembers: (key: string) => {
      commands.push(() => Promise.resolve(mockSMembers(key)));
      return chain;
    },
    expire: (key: string, seconds: number) => {
      commands.push(() => Promise.resolve(mockExpire(key, seconds)));
      return chain;
    },
    exec: async () => {
      const results = [];
      for (const cmd of commands) {
        results.push(await cmd());
      }
      return results;
    }
  };
  return chain;
};

vi.mock('@tearleads/shared/redis', () => {
  const client = {
    get: mockGet,
    set: mockSet,
    del: mockDel,
    expire: mockExpire,
    ttl: mockTtl,
    sAdd: mockSAdd,
    sRem: mockSRem,
    sMembers: mockSMembers,
    mGet: mockMGet,
    multi: createMockMulti
  };
  return {
    getRedisClient: vi.fn(() => Promise.resolve(client)),
    getRedisSubscriberOverride: () => client,
    setRedisSubscriberOverrideForTesting: vi.fn()
  };
});

describe('sessions token operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    userSessionsStore.clear();
    sessionTtl.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('rotateTokensAtomically', () => {
    it('atomically rotates session and refresh tokens', async () => {
      const {
        createSession,
        storeRefreshToken,
        getSession,
        getRefreshToken,
        rotateTokensAtomically
      } = await import('./sessions.js');

      await createSession('old-session', {
        userId: 'user-atomic',
        email: 'atomic@test.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      await storeRefreshToken(
        'old-refresh-token',
        { sessionId: 'old-session', userId: 'user-atomic' },
        3600
      );

      await rotateTokensAtomically({
        oldRefreshTokenId: 'old-refresh-token',
        oldSessionId: 'old-session',
        newSessionId: 'new-session',
        newRefreshTokenId: 'new-refresh-token',
        sessionData: {
          userId: 'user-atomic',
          email: 'atomic@test.com',
          admin: false,
          ipAddress: '192.168.1.1'
        },
        sessionTtlSeconds: 3600,
        refreshTokenTtlSeconds: 604800
      });

      const oldSession = await getSession('old-session');
      expect(oldSession).toBeNull();

      const oldRefreshToken = await getRefreshToken('old-refresh-token');
      expect(oldRefreshToken).toBeNull();

      const newSession = await getSession('new-session');
      expect(newSession).toMatchObject({
        userId: 'user-atomic',
        email: 'atomic@test.com',
        admin: false,
        ipAddress: '192.168.1.1'
      });

      const newRefreshToken = await getRefreshToken('new-refresh-token');
      expect(newRefreshToken).toMatchObject({
        sessionId: 'new-session',
        userId: 'user-atomic'
      });
    });

    it('preserves original createdAt when provided', async () => {
      vi.useFakeTimers();
      const {
        createSession,
        storeRefreshToken,
        getSession,
        rotateTokensAtomically
      } = await import('./sessions.js');

      const originalCreatedAt = '2024-01-01T00:00:00.000Z';
      vi.setSystemTime(new Date(originalCreatedAt));

      await createSession('old-session-preserve', {
        userId: 'user-preserve',
        email: 'preserve@test.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      await storeRefreshToken(
        'old-refresh-preserve',
        { sessionId: 'old-session-preserve', userId: 'user-preserve' },
        3600
      );

      vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

      await rotateTokensAtomically({
        oldRefreshTokenId: 'old-refresh-preserve',
        oldSessionId: 'old-session-preserve',
        newSessionId: 'new-session-preserve',
        newRefreshTokenId: 'new-refresh-preserve',
        sessionData: {
          userId: 'user-preserve',
          email: 'preserve@test.com',
          admin: false,
          ipAddress: '192.168.1.1'
        },
        sessionTtlSeconds: 3600,
        refreshTokenTtlSeconds: 604800,
        originalCreatedAt
      });

      const newSession = await getSession('new-session-preserve');
      expect(newSession).not.toBeNull();
      expect(newSession?.createdAt).toBe(originalCreatedAt);
      expect(newSession?.lastActiveAt).toBe('2024-01-15T12:00:00.000Z');

      vi.useRealTimers();
    });

    it('uses current time for createdAt when originalCreatedAt not provided', async () => {
      vi.useFakeTimers();
      const {
        createSession,
        storeRefreshToken,
        getSession,
        rotateTokensAtomically
      } = await import('./sessions.js');

      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

      await createSession('old-session-new-created', {
        userId: 'user-new-created',
        email: 'new-created@test.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      await storeRefreshToken(
        'old-refresh-new-created',
        { sessionId: 'old-session-new-created', userId: 'user-new-created' },
        3600
      );

      vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

      await rotateTokensAtomically({
        oldRefreshTokenId: 'old-refresh-new-created',
        oldSessionId: 'old-session-new-created',
        newSessionId: 'new-session-new-created',
        newRefreshTokenId: 'new-refresh-new-created',
        sessionData: {
          userId: 'user-new-created',
          email: 'new-created@test.com',
          admin: false,
          ipAddress: '192.168.1.1'
        },
        sessionTtlSeconds: 3600,
        refreshTokenTtlSeconds: 604800
      });

      const newSession = await getSession('new-session-new-created');
      expect(newSession).not.toBeNull();
      expect(newSession?.createdAt).toBe('2024-01-15T12:00:00.000Z');
      expect(newSession?.lastActiveAt).toBe('2024-01-15T12:00:00.000Z');

      vi.useRealTimers();
    });
  });

  describe('deleteAllSessionsForUser', () => {
    it('deletes all sessions for a user', async () => {
      const { createSession, getSession, deleteAllSessionsForUser } =
        await import('./sessions.js');

      await createSession('session-1', {
        userId: 'user-delete-all',
        email: 'deleteall@test.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      await createSession('session-2', {
        userId: 'user-delete-all',
        email: 'deleteall@test.com',
        admin: false,
        ipAddress: '127.0.0.2'
      });

      await createSession('session-3', {
        userId: 'user-delete-all',
        email: 'deleteall@test.com',
        admin: false,
        ipAddress: '127.0.0.3'
      });

      const session1Before = await getSession('session-1');
      const session2Before = await getSession('session-2');
      const session3Before = await getSession('session-3');
      expect(session1Before).not.toBeNull();
      expect(session2Before).not.toBeNull();
      expect(session3Before).not.toBeNull();

      const deletedCount = await deleteAllSessionsForUser('user-delete-all');

      expect(deletedCount).toBe(3);

      const session1After = await getSession('session-1');
      const session2After = await getSession('session-2');
      const session3After = await getSession('session-3');
      expect(session1After).toBeNull();
      expect(session2After).toBeNull();
      expect(session3After).toBeNull();
    });

    it('returns 0 when user has no sessions', async () => {
      const { deleteAllSessionsForUser } = await import('./sessions.js');

      const deletedCount = await deleteAllSessionsForUser(
        'user-with-no-sessions'
      );

      expect(deletedCount).toBe(0);
    });

    it('does not affect sessions of other users', async () => {
      const { createSession, getSession, deleteAllSessionsForUser } =
        await import('./sessions.js');

      await createSession('user1-session', {
        userId: 'user-1-isolated',
        email: 'user1@test.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      await createSession('user2-session', {
        userId: 'user-2-isolated',
        email: 'user2@test.com',
        admin: false,
        ipAddress: '127.0.0.2'
      });

      await deleteAllSessionsForUser('user-1-isolated');

      const user1Session = await getSession('user1-session');
      const user2Session = await getSession('user2-session');
      expect(user1Session).toBeNull();
      expect(user2Session).not.toBeNull();
    });
  });
});
