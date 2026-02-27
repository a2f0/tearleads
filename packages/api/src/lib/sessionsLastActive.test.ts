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

describe('sessions getLatestLastActiveByUserIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    userSessionsStore.clear();
    sessionTtl.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns the latest activity per user', async () => {
    vi.useFakeTimers();
    const { createSession, getLatestLastActiveByUserIds } = await import(
      './sessions.js'
    );

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await createSession('session-1', {
      userId: 'user-1',
      email: 'user1@example.com',
      ipAddress: '127.0.0.1',
      admin: false
    });

    vi.setSystemTime(new Date('2024-01-03T00:00:00.000Z'));
    await createSession('session-2', {
      userId: 'user-1',
      email: 'user1@example.com',
      ipAddress: '127.0.0.1',
      admin: false
    });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    await createSession('session-3', {
      userId: 'user-2',
      email: 'user2@example.com',
      ipAddress: '127.0.0.1',
      admin: false
    });

    const result = await getLatestLastActiveByUserIds([
      'user-1',
      'user-2',
      'user-3'
    ]);

    expect(result).toEqual({
      'user-1': '2024-01-03T00:00:00.000Z',
      'user-2': '2024-01-02T00:00:00.000Z',
      'user-3': null
    });
    vi.useRealTimers();
  });

  it('returns null when session data is invalid', async () => {
    const { getLatestLastActiveByUserIds } = await import('./sessions.js');

    userSessionsStore.set('user_sessions:user-1', new Set(['bad-session']));
    sessionStore.set('session:bad-session', 'not valid json {{{');

    const result = await getLatestLastActiveByUserIds(['user-1']);

    expect(result).toEqual({ 'user-1': null });
  });

  it('skips mismatched user IDs and invalid timestamps', async () => {
    const { getLatestLastActiveByUserIds } = await import('./sessions.js');

    userSessionsStore.set(
      'user_sessions:user-1',
      new Set(['session-mismatch', 'session-bad-timestamp'])
    );

    sessionStore.set(
      'session:session-mismatch',
      JSON.stringify({
        userId: 'user-2',
        email: 'user2@example.com',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastActiveAt: '2024-01-04T00:00:00.000Z',
        ipAddress: '127.0.0.1'
      })
    );

    sessionStore.set(
      'session:session-bad-timestamp',
      JSON.stringify({
        userId: 'user-1',
        email: 'user1@example.com',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastActiveAt: 'not-a-date',
        ipAddress: '127.0.0.1'
      })
    );

    const result = await getLatestLastActiveByUserIds(['user-1']);

    expect(result).toEqual({ 'user-1': null });
  });

  it('skips empty session identifiers', async () => {
    const { getLatestLastActiveByUserIds } = await import('./sessions.js');

    userSessionsStore.set('user_sessions:user-1', new Set(['']));

    const result = await getLatestLastActiveByUserIds(['user-1']);

    expect(result).toEqual({ 'user-1': null });
  });

  it('returns nulls when redis client fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getRedisClient } = await import('@tearleads/shared/redis');
    vi.mocked(getRedisClient).mockRejectedValueOnce(new Error('redis down'));

    const { getLatestLastActiveByUserIds } = await import('./sessions.js');
    const result = await getLatestLastActiveByUserIds(['user-1']);

    expect(result).toEqual({ 'user-1': null });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
