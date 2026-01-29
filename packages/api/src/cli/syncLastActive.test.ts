import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runSyncLastActive,
  runSyncLastActiveFromArgv
} from './syncLastActive.js';

const mockGetPostgresPool = vi.fn();
const mockGetPostgresConnectionInfo = vi.fn();
const mockClosePostgresPool = vi.fn();
const mockGetLatestLastActiveByUserIds = vi.fn();
const mockCloseRedisClient = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: () => mockGetPostgresConnectionInfo(),
  closePostgresPool: () => mockClosePostgresPool()
}));

vi.mock('../lib/redis.js', () => ({
  closeRedisClient: () => mockCloseRedisClient()
}));

vi.mock('../lib/sessions.js', () => ({
  getLatestLastActiveByUserIds: (userIds: string[]) =>
    mockGetLatestLastActiveByUserIds(userIds)
}));

describe('sync-last-active cli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPostgresConnectionInfo.mockReturnValue({
      host: 'localhost',
      port: 5432,
      user: 'rapid',
      database: 'rapid_test'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles no users to sync', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn()
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({});

    expect(result.processed).toBe(0);
    expect(result.updated).toBe(0);
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT id FROM users ORDER BY id'
    );
    consoleLog.mockRestore();
  });

  it('updates users with Redis activity', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }]
      }),
      connect: vi.fn().mockResolvedValue(mockClient)
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-15T10:00:00.000Z',
      'user-2': null,
      'user-3': '2024-01-15T11:00:00.000Z'
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('UPDATE users SET last_active_at')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({});

    expect(result.processed).toBe(3);
    expect(result.updated).toBe(2);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it('skips users without Redis activity', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'user-1' }, { id: 'user-2' }]
      }),
      connect: vi.fn().mockResolvedValue(mockClient)
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': null,
      'user-2': null
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({});

    expect(result.processed).toBe(2);
    expect(result.updated).toBe(0);

    const updateCalls = mockClient.query.mock.calls.filter(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE users SET last_active_at')
    );
    expect(updateCalls).toHaveLength(0);
    consoleLog.mockRestore();
  });

  it('dry run mode does not update database', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'user-1' }]
      }),
      connect: vi.fn().mockResolvedValue(mockClient)
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-15T10:00:00.000Z'
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({ dryRun: true });

    expect(result.processed).toBe(1);
    expect(result.updated).toBe(1);

    const updateCalls = mockClient.query.mock.calls.filter(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE users SET last_active_at')
    );
    expect(updateCalls).toHaveLength(0);
    consoleLog.mockRestore();
  });

  it('rolls back on error', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'user-1' }]
      }),
      connect: vi.fn().mockResolvedValue(mockClient)
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-15T10:00:00.000Z'
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') {
        return Promise.resolve({ rows: [] });
      }
      if (sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('UPDATE users SET last_active_at')) {
        throw new Error('Database error');
      }
      return Promise.resolve({ rows: [] });
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(runSyncLastActive({})).rejects.toThrow('Database error');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it('processes users in batches', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 'user-1' },
          { id: 'user-2' },
          { id: 'user-3' },
          { id: 'user-4' },
          { id: 'user-5' }
        ]
      }),
      connect: vi.fn().mockResolvedValue(mockClient)
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-15T10:00:00.000Z',
      'user-2': '2024-01-15T10:00:00.000Z',
      'user-3': '2024-01-15T10:00:00.000Z',
      'user-4': '2024-01-15T10:00:00.000Z',
      'user-5': '2024-01-15T10:00:00.000Z'
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('UPDATE users SET last_active_at')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({ batchSize: '2' });

    expect(result.processed).toBe(5);
    expect(result.updated).toBe(5);

    // Should have 3 batches: [user-1, user-2], [user-3, user-4], [user-5]
    expect(mockGetLatestLastActiveByUserIds).toHaveBeenCalledTimes(3);
    expect(mockPool.connect).toHaveBeenCalledTimes(3);

    consoleLog.mockRestore();
  });

  it('prints help from argv and closes connections', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runSyncLastActiveFromArgv(['--help']);

    expect(mockCloseRedisClient).toHaveBeenCalled();
    expect(mockClosePostgresPool).toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it('rejects invalid batch size', async () => {
    await expect(runSyncLastActive({ batchSize: 'invalid' })).rejects.toThrow(
      'Invalid batch size. Must be a positive integer.'
    );
  });

  it('rejects zero batch size', async () => {
    await expect(runSyncLastActive({ batchSize: '0' })).rejects.toThrow(
      'Invalid batch size. Must be a positive integer.'
    );
  });

  it('rejects negative batch size', async () => {
    await expect(runSyncLastActive({ batchSize: '-5' })).rejects.toThrow(
      'Invalid batch size. Must be a positive integer.'
    );
  });
});
