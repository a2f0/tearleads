import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMakeAdmin, runMakeAdminFromArgv } from './makeAdmin.js';

const mockGetPostgresPool = vi.fn();
const mockGetPostgresConnectionInfo = vi.fn();
const mockClosePostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: () => mockGetPostgresConnectionInfo(),
  closePostgresPool: () => mockClosePostgresPool()
}));

describe('make admin cli', () => {
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

  it('requires an email', async () => {
    await expect(runMakeAdmin({})).rejects.toThrow(
      'Email is required. Use --email or -e.'
    );
  });

  it('grants admin privileges to an existing user', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (sql.startsWith('UPDATE users SET admin')) {
        return Promise.resolve({ rows: [{ id: 'user-1' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runMakeAdmin({ email: 'User@Example.com' });

    const updateCall = mockClient.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' && sql.startsWith('UPDATE users SET admin')
    );

    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual(['user@example.com']);
    expect(mockClient.release).toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it('throws when the user does not exist and rolls back', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (sql.startsWith('UPDATE users SET admin')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      runMakeAdmin({ email: 'missing@example.com' })
    ).rejects.toThrow('No account found for missing@example.com.');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('prints help from argv and closes the pool', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runMakeAdminFromArgv(['--help']);

    expect(mockClosePostgresPool).toHaveBeenCalled();
    consoleLog.mockRestore();
  });
});
