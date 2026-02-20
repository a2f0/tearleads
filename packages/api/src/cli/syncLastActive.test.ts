import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSyncLastActive } from './syncLastActive.js';

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

vi.mock('@tearleads/shared/redis', () => ({
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
      user: 'tearleads',
      database: 'tearleads_test'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles no users to sync', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] })
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({});

    expect(result.processed).toBe(0);
    expect(result.updated).toBe(0);
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT COUNT(*) as count FROM users'
    );
    consoleLog.mockRestore();
  });

  it('updates users with Redis activity using batch update', async () => {
    const mockPool = {
      query: vi.fn()
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    // Mock COUNT query, then SELECT batch, then UPDATE
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // COUNT
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }]
      }) // SELECT batch
      .mockResolvedValueOnce({ rowCount: 2 }); // UPDATE

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-15T10:00:00.000Z',
      'user-2': null,
      'user-3': '2024-01-15T11:00:00.000Z'
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({});

    expect(result.processed).toBe(3);
    expect(result.updated).toBe(2);

    // Verify batch UPDATE was called with unnest
    const updateCall = mockPool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('unnest')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual([
      ['user-1', 'user-3'],
      ['2024-01-15T10:00:00.000Z', '2024-01-15T11:00:00.000Z']
    ]);

    consoleLog.mockRestore();
  });

  it('skips users without Redis activity', async () => {
    const mockPool = {
      query: vi.fn()
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1' }, { id: 'user-2' }]
      });

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': null,
      'user-2': null
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({});

    expect(result.processed).toBe(2);
    expect(result.updated).toBe(0);

    // No UPDATE should be called
    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE')
    );
    expect(updateCalls).toHaveLength(0);
    consoleLog.mockRestore();
  });

  it('dry run mode does not update database', async () => {
    const mockPool = {
      query: vi.fn()
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] });

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-15T10:00:00.000Z'
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({ dryRun: true });

    expect(result.processed).toBe(1);
    expect(result.updated).toBe(1);

    // No UPDATE should be called in dry run
    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE')
    );
    expect(updateCalls).toHaveLength(0);
    consoleLog.mockRestore();
  });

  it('processes users in batches using cursor-based pagination', async () => {
    const mockPool = {
      query: vi.fn()
    };
    mockGetPostgresPool.mockResolvedValue(mockPool);

    // COUNT, then 3 batches of SELECT, then 3 batch UPDATEs
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // COUNT
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1' }, { id: 'user-2' }]
      }) // Batch 1
      .mockResolvedValueOnce({ rowCount: 2 }) // UPDATE 1
      .mockResolvedValueOnce({
        rows: [{ id: 'user-3' }, { id: 'user-4' }]
      }) // Batch 2
      .mockResolvedValueOnce({ rowCount: 2 }) // UPDATE 2
      .mockResolvedValueOnce({ rows: [{ id: 'user-5' }] }) // Batch 3
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE 3

    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-15T10:00:00.000Z',
      'user-2': '2024-01-15T10:00:00.000Z',
      'user-3': '2024-01-15T10:00:00.000Z',
      'user-4': '2024-01-15T10:00:00.000Z',
      'user-5': '2024-01-15T10:00:00.000Z'
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSyncLastActive({ batchSize: '2' });

    expect(result.processed).toBe(5);
    expect(result.updated).toBe(5);

    // Should have 3 batches
    expect(mockGetLatestLastActiveByUserIds).toHaveBeenCalledTimes(3);

    // Verify cursor-based pagination - second SELECT should have WHERE id > 'user-2'
    const selectCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('SELECT id FROM users')
    );
    expect(selectCalls).toHaveLength(3);
    expect(selectCalls[1]?.[1]).toEqual(['user-2', 2]); // lastId, batchSize

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
