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

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: vi.fn(() =>
    Promise.resolve({
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
    it('updates lastActiveAt when session is valid', async () => {
      vi.useFakeTimers();
      const { updateSessionActivity } = await import('./sessions.js');

      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      sessionStore.set(
        'session:valid-session',
        JSON.stringify({
          userId: 'user-1',
          email: 'test@example.com',
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date('2023-12-31T00:00:00.000Z').toISOString(),
          ipAddress: '127.0.0.1'
        })
      );
      sessionTtl.set('session:valid-session', 3600);

      vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
      await updateSessionActivity('valid-session');

      const stored = sessionStore.get('session:valid-session');
      expect(stored).toContain('2024-01-02T00:00:00.000Z');
      vi.useRealTimers();
    });

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
        ipAddress: '127.0.0.1',
        admin: false
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

  describe('getSession admin validation', () => {
    it('returns null when admin field is defined but not a boolean', async () => {
      const { getSession } = await import('./sessions.js');

      sessionStore.set(
        'session:invalid-admin',
        JSON.stringify({
          userId: 'user-1',
          email: 'test@example.com',
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          ipAddress: '127.0.0.1',
          admin: 'yes'
        })
      );

      const result = await getSession('invalid-admin');

      expect(result).toBeNull();
    });
  });

  describe('getRefreshToken edge cases', () => {
    it('returns null for invalid JSON', async () => {
      const { getRefreshToken } = await import('./sessions.js');

      sessionStore.set('refresh_token:invalid-json', 'not valid json {{{');

      const result = await getRefreshToken('invalid-json');

      expect(result).toBeNull();
    });

    it('returns null for non-object data', async () => {
      const { getRefreshToken } = await import('./sessions.js');

      sessionStore.set(
        'refresh_token:non-object',
        JSON.stringify('just a string')
      );

      const result = await getRefreshToken('non-object');

      expect(result).toBeNull();
    });

    it('returns null when required fields have wrong types', async () => {
      const { getRefreshToken } = await import('./sessions.js');

      sessionStore.set(
        'refresh_token:wrong-types',
        JSON.stringify({
          sessionId: 123,
          userId: 'user-1',
          createdAt: new Date().toISOString()
        })
      );

      const result = await getRefreshToken('wrong-types');

      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('deletes session and removes from user sessions set', async () => {
      const { createSession, deleteSession, getSession } = await import(
        './sessions.js'
      );

      await createSession('session-to-delete', {
        userId: 'user-delete-test',
        email: 'delete@test.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const sessionBefore = await getSession('session-to-delete');
      expect(sessionBefore).not.toBeNull();

      const deleted = await deleteSession(
        'session-to-delete',
        'user-delete-test'
      );

      expect(deleted).toBe(true);

      const sessionAfter = await getSession('session-to-delete');
      expect(sessionAfter).toBeNull();

      expect(mockSRem).toHaveBeenCalledWith(
        'user_sessions:user-delete-test',
        'session-to-delete'
      );
    });

    it('returns false when session does not exist', async () => {
      const { deleteSession } = await import('./sessions.js');

      const deleted = await deleteSession('nonexistent-session', 'user-1');

      expect(deleted).toBe(false);
    });

    it('returns false when session belongs to different user', async () => {
      const { createSession, deleteSession, getSession } = await import(
        './sessions.js'
      );

      await createSession('session-wrong-user', {
        userId: 'user-owner',
        email: 'owner@test.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const deleted = await deleteSession(
        'session-wrong-user',
        'user-attacker'
      );

      expect(deleted).toBe(false);

      const session = await getSession('session-wrong-user');
      expect(session).not.toBeNull();
    });
  });
});
