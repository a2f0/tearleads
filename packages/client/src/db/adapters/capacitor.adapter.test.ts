import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCapacitorClearEncryptionSecret,
  mockCapacitorDeleteDatabase,
  mockDeleteCapacitorDatabaseFile,
  mockGetSQLiteConnection,
  mockIsIgnorableDeleteDbError
} = vi.hoisted(() => ({
  mockCapacitorClearEncryptionSecret: vi.fn(),
  mockCapacitorDeleteDatabase: vi.fn(),
  mockDeleteCapacitorDatabaseFile: vi.fn(),
  mockGetSQLiteConnection: vi.fn(),
  mockIsIgnorableDeleteDbError: vi.fn()
}));

vi.mock('./capacitorAdapterHelpers', () => ({
  deleteCapacitorDatabaseFile: mockDeleteCapacitorDatabaseFile,
  getSQLiteConnection: mockGetSQLiteConnection,
  isIgnorableDeleteDbError: mockIsIgnorableDeleteDbError,
  resetSQLiteConnectionCache: vi.fn()
}));

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {
    clearEncryptionSecret: mockCapacitorClearEncryptionSecret,
    deleteDatabase: mockCapacitorDeleteDatabase
  }
}));

import { CapacitorAdapter } from './capacitor.adapter';

function createSqliteConnectionMock() {
  return {
    clearEncryptionSecret: vi.fn().mockResolvedValue(undefined),
    closeConnection: vi.fn().mockResolvedValue(undefined),
    createConnection: vi.fn(),
    isConnection: vi.fn().mockResolvedValue({ result: false }),
    isSecretStored: vi.fn().mockResolvedValue({ result: true }),
    setEncryptionSecret: vi.fn()
  };
}

describe('CapacitorAdapter', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockCapacitorClearEncryptionSecret.mockResolvedValue(undefined);
    mockDeleteCapacitorDatabaseFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('recovers state errors by deleting stale file when plugin delete needs a connection', async () => {
    const sqlite = createSqliteConnectionMock();
    const dbConnection = {
      open: vi.fn().mockResolvedValue(undefined)
    };

    sqlite.setEncryptionSecret
      .mockRejectedValueOnce(
        new Error('SetEncryptionSecret: State for: tearleads-testSQLite.db not correct')
      )
      .mockResolvedValueOnce(undefined);
    sqlite.createConnection.mockResolvedValue(dbConnection);

    mockGetSQLiteConnection.mockResolvedValue(sqlite);
    mockIsIgnorableDeleteDbError.mockReturnValue(true);
    mockCapacitorDeleteDatabase.mockRejectedValue(
      new Error(
        'deleteDatabase: No available connection for database tearleads-test'
      )
    );

    const adapter = new CapacitorAdapter();
    await adapter.initialize({
      encryptionKey: new Uint8Array([1, 2, 3, 4]),
      name: 'tearleads-test'
    });

    expect(sqlite.setEncryptionSecret).toHaveBeenCalledTimes(2);
    expect(mockCapacitorDeleteDatabase).toHaveBeenCalledWith({
      database: 'tearleads-test'
    });
    expect(mockDeleteCapacitorDatabaseFile).toHaveBeenCalledWith(
      'tearleads-test'
    );
    expect(warnSpy).toHaveBeenCalled();
    expect(dbConnection.open).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-ignorable plugin delete errors during state recovery', async () => {
    const sqlite = createSqliteConnectionMock();
    sqlite.setEncryptionSecret.mockRejectedValueOnce(
      new Error('SetEncryptionSecret: State for: tearleads-testSQLite.db not correct')
    );

    mockGetSQLiteConnection.mockResolvedValue(sqlite);
    mockIsIgnorableDeleteDbError.mockReturnValue(false);
    mockCapacitorDeleteDatabase.mockRejectedValue(
      new Error('deleteDatabase: permission denied')
    );

    const adapter = new CapacitorAdapter();
    await expect(
      adapter.initialize({
        encryptionKey: new Uint8Array([1, 2, 3, 4]),
        name: 'tearleads-test'
      })
    ).rejects.toThrow('deleteDatabase: permission denied');

    expect(mockDeleteCapacitorDatabaseFile).not.toHaveBeenCalled();
  });
});
