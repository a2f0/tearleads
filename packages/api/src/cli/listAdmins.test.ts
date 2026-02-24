import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runListAdmins, runListAdminsFromArgv } from './listAdmins.js';

const mockGetPostgresPool = vi.fn();
const mockGetPostgresConnectionInfo = vi.fn();
const mockClosePostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: () => mockGetPostgresConnectionInfo(),
  closePostgresPool: () => mockClosePostgresPool()
}));

describe('list admins cli', () => {
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

  it('prints a message when no admins are found', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runListAdmins();

    expect(consoleLog).toHaveBeenCalledWith('No admin accounts found.');
    expect(consoleLog).toHaveBeenCalledWith(
      'Postgres connection: host=localhost, port=5432, user=tearleads, database=tearleads_test'
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('prints admin accounts in order', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 'admin-1', email: 'admin1@example.com' },
          { id: 'admin-2', email: 'admin2@example.com' }
        ]
      }),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runListAdmins();

    expect(consoleLog).toHaveBeenCalledWith('Admin accounts:');
    expect(consoleLog).toHaveBeenCalledWith(
      '- admin1@example.com (id admin-1)'
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '- admin2@example.com (id admin-2)'
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('outputs JSON array when json flag is true', async () => {
    const rows = [
      { id: 'admin-1', email: 'admin1@example.com' },
      { id: 'admin-2', email: 'admin2@example.com' }
    ];
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows }),
      release: vi.fn()
    };
    const mockConnect = vi.fn().mockResolvedValue(mockClient);
    mockGetPostgresPool.mockResolvedValue({ connect: mockConnect });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runListAdmins(true);

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

    await runListAdminsFromArgv(['--json']);

    expect(consoleLog).toHaveBeenCalledWith('[]');
    expect(mockClosePostgresPool).toHaveBeenCalled();
  });

  it('prints help from argv and closes the pool', async () => {
    await runListAdminsFromArgv(['--help']);

    expect(mockClosePostgresPool).toHaveBeenCalled();
  });

  it('rejects unknown arguments and closes the pool', async () => {
    await expect(runListAdminsFromArgv(['--nope'])).rejects.toThrow(
      'Unknown argument: --nope'
    );

    expect(mockClosePostgresPool).toHaveBeenCalled();
  });
});
