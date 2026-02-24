import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runListUsers, runListUsersFromArgv } from './listUsers.js';

const mockGetPostgresPool = vi.fn();
const mockGetPostgresConnectionInfo = vi.fn();
const mockClosePostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: () => mockGetPostgresConnectionInfo(),
  closePostgresPool: () => mockClosePostgresPool()
}));

describe('list users cli', () => {
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

  it('prints a message when no users are found', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runListUsers();

    expect(consoleLog).toHaveBeenCalledWith('No user accounts found.');
    expect(consoleLog).toHaveBeenCalledWith(
      'Postgres connection: host=localhost, port=5432, user=tearleads, database=tearleads_test'
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('prints user accounts with admin tag', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 'user-1', email: 'user1@example.com', admin: false },
          { id: 'user-2', email: 'user2@example.com', admin: true }
        ]
      }),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runListUsers();

    expect(consoleLog).toHaveBeenCalledWith('User accounts:');
    expect(consoleLog).toHaveBeenCalledWith('- user1@example.com (id user-1)');
    expect(consoleLog).toHaveBeenCalledWith(
      '- user2@example.com (id user-2) [admin]'
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('outputs JSON array when json flag is true', async () => {
    const rows = [
      { id: 'user-1', email: 'user1@example.com', admin: false },
      { id: 'user-2', email: 'user2@example.com', admin: true }
    ];
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows }),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runListUsers(true);

    expect(consoleLog).toHaveBeenCalledWith(JSON.stringify(rows));
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('parses --json from argv', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runListUsersFromArgv(['--json']);

    expect(consoleLog).toHaveBeenCalledWith('[]');
    expect(mockClosePostgresPool).toHaveBeenCalled();
  });

  it('prints help from argv and closes the pool', async () => {
    await runListUsersFromArgv(['--help']);

    expect(mockClosePostgresPool).toHaveBeenCalled();
  });

  it('rejects unknown arguments and closes the pool', async () => {
    await expect(runListUsersFromArgv(['--nope'])).rejects.toThrow(
      'Unknown argument: --nope'
    );

    expect(mockClosePostgresPool).toHaveBeenCalled();
  });
});
