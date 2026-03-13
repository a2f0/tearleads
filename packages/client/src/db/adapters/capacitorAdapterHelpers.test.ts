import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as helpers from './capacitorAdapterHelpers';

interface HelpersModule {
  deleteCapacitorDatabaseFile: (databaseName: string) => Promise<void>;
  getSQLiteConnection: () => Promise<unknown>;
  isIgnorableDeleteDbError: (error: unknown) => boolean;
  resetSQLiteConnectionCache: () => void;
}

interface LoadedHelpers {
  deleteFile: ReturnType<typeof vi.fn>;
  getPlatform: ReturnType<typeof vi.fn>;
  module: HelpersModule;
  echo: ReturnType<typeof vi.fn>;
  SQLiteConnection: ReturnType<typeof vi.fn>;
}

interface LoadHelpersOptions {
  echoError?: Error;
  platform?: 'ios' | 'android' | 'web';
}

const mockedCapacitorModules = (() => {
  let instanceCount = 0;

  const echo = vi.fn();
  const getPlatform = vi.fn();
  const deleteFile = vi.fn();
  const SQLiteConnection = vi.fn(function MockSQLiteConnection() {
    instanceCount += 1;
    return { id: instanceCount };
  });

  const reset = (): void => {
    instanceCount = 0;
    echo.mockReset();
    echo.mockResolvedValue({ value: 'test' });
    getPlatform.mockReset();
    getPlatform.mockReturnValue('ios');
    deleteFile.mockReset();
    SQLiteConnection.mockReset();
    SQLiteConnection.mockImplementation(function MockSQLiteConnection() {
      instanceCount += 1;
      return { id: instanceCount };
    });
  };

  return {
    echo,
    getPlatform,
    deleteFile,
    SQLiteConnection,
    reset
  };
})();

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {
    echo: (...args: unknown[]) => mockedCapacitorModules.echo(...args)
  },
  SQLiteConnection: function SQLiteConnection(...args: unknown[]) {
    return mockedCapacitorModules.SQLiteConnection(...args);
  }
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: (...args: unknown[]) =>
      mockedCapacitorModules.getPlatform(...args)
  }
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: {
    Data: 'DATA',
    Library: 'LIBRARY'
  },
  Filesystem: {
    deleteFile: (...args: unknown[]) =>
      mockedCapacitorModules.deleteFile(...args)
  }
}));

function loadHelpers(options: LoadHelpersOptions = {}): LoadedHelpers {
  const { echoError, platform = 'ios' } = options;

  mockedCapacitorModules.getPlatform.mockReturnValue(platform);

  if (echoError) {
    mockedCapacitorModules.echo.mockRejectedValue(echoError);
  } else {
    mockedCapacitorModules.echo.mockResolvedValue({ value: 'test' });
  }

  return {
    deleteFile: mockedCapacitorModules.deleteFile,
    getPlatform: mockedCapacitorModules.getPlatform,
    module: helpers,
    echo: mockedCapacitorModules.echo,
    SQLiteConnection: mockedCapacitorModules.SQLiteConnection
  };
}

beforeEach(() => {
  mockedCapacitorModules.reset();
  helpers.resetSQLiteConnectionCache();
});

describe('capacitorAdapterHelpers', () => {
  describe('isIgnorableDeleteDbError', () => {
    it('returns true for known ignorable delete-db messages', () => {
      const { module } = loadHelpers();

      expect(
        module.isIgnorableDeleteDbError(new Error('Database not found'))
      ).toBe(true);
      expect(
        module.isIgnorableDeleteDbError(
          new Error('No Available Connection for tearleads')
        )
      ).toBe(true);
    });

    it('returns false for non-error and non-ignorable errors', () => {
      const { module } = loadHelpers();

      expect(module.isIgnorableDeleteDbError('not-an-error')).toBe(false);
      expect(
        module.isIgnorableDeleteDbError(new Error('permission denied'))
      ).toBe(false);
    });
  });

  describe('getSQLiteConnection', () => {
    it('caches and reuses the same SQLiteConnection instance', async () => {
      const { module, echo, SQLiteConnection } = loadHelpers();

      const first = await module.getSQLiteConnection();
      const second = await module.getSQLiteConnection();

      expect(first).toBe(second);
      expect(echo).toHaveBeenCalledTimes(1);
      expect(SQLiteConnection).toHaveBeenCalledTimes(1);
    });

    it('creates a new connection after cache reset', async () => {
      const { module, SQLiteConnection } = loadHelpers();

      const first = await module.getSQLiteConnection();
      module.resetSQLiteConnectionCache();
      const second = await module.getSQLiteConnection();

      expect(first).not.toBe(second);
      expect(SQLiteConnection).toHaveBeenCalledTimes(2);
    });

    it('throws an actionable plugin init error when Capacitor plugin is null', async () => {
      const { module, SQLiteConnection } = loadHelpers({
        echoError: new Error('CapacitorSQLitePlugin: null')
      });

      await expect(module.getSQLiteConnection()).rejects.toThrow(
        'SQLite plugin failed to initialize'
      );
      expect(SQLiteConnection).not.toHaveBeenCalled();
    });

    it('rethrows non-plugin echo errors', async () => {
      const echoError = new Error('Echo failed for unknown reason');
      const { module, SQLiteConnection } = loadHelpers({ echoError });

      await expect(module.getSQLiteConnection()).rejects.toThrow(
        'Echo failed for unknown reason'
      );
      expect(SQLiteConnection).not.toHaveBeenCalled();
    });
  });

  describe('deleteCapacitorDatabaseFile', () => {
    it('deletes iOS databases from Library/CapacitorDatabase', async () => {
      const { module, deleteFile, getPlatform } = loadHelpers({
        platform: 'ios'
      });

      await module.deleteCapacitorDatabaseFile('tearleads-abc');

      expect(getPlatform).toHaveBeenCalledTimes(1);
      expect(deleteFile).toHaveBeenCalledTimes(1);
      expect(deleteFile).toHaveBeenCalledWith({
        path: 'CapacitorDatabase/tearleads-abcSQLite.db',
        directory: 'LIBRARY'
      });
    });

    it('falls back to Library path when Android Data deletion fails', async () => {
      const { module, deleteFile } = loadHelpers({
        platform: 'android'
      });
      deleteFile.mockRejectedValueOnce(new Error('not found'));
      deleteFile.mockResolvedValueOnce(undefined);

      await module.deleteCapacitorDatabaseFile('tearleads-xyz');

      expect(deleteFile).toHaveBeenCalledTimes(2);
      expect(deleteFile).toHaveBeenNthCalledWith(1, {
        path: '../databases/tearleads-xyzSQLite.db',
        directory: 'DATA'
      });
      expect(deleteFile).toHaveBeenNthCalledWith(2, {
        path: 'CapacitorDatabase/tearleads-xyzSQLite.db',
        directory: 'LIBRARY'
      });
    });

    it('warns when all direct deletion targets fail', async () => {
      const { module, deleteFile } = loadHelpers({
        platform: 'android'
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      deleteFile.mockRejectedValue(new Error('permission denied'));

      await module.deleteCapacitorDatabaseFile('tearleads-failed');

      expect(deleteFile).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to delete stale Capacitor DB file for tearleads-failed'
        )
      );
      warnSpy.mockRestore();
    });
  });
});
