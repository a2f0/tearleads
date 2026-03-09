import { afterEach, describe, expect, it, vi } from 'vitest';

interface HelpersModule {
  getSQLiteConnection: () => Promise<unknown>;
  isIgnorableDeleteDbError: (error: unknown) => boolean;
  resetSQLiteConnectionCache: () => void;
}

interface LoadedHelpers {
  module: HelpersModule;
  echo: ReturnType<typeof vi.fn>;
  SQLiteConnection: ReturnType<typeof vi.fn>;
}

async function loadHelpers(echoError?: Error): Promise<LoadedHelpers> {
  vi.resetModules();

  let instanceCount = 0;
  const echo = vi.fn();
  if (echoError) {
    echo.mockRejectedValue(echoError);
  } else {
    echo.mockResolvedValue({ value: 'test' });
  }

  const SQLiteConnection = vi.fn(function MockSQLiteConnection() {
    return { id: ++instanceCount };
  });

  vi.doMock('@capacitor-community/sqlite', () => ({
    CapacitorSQLite: { echo },
    SQLiteConnection
  }));

  const module = await import('./capacitorAdapterHelpers');
  return {
    module,
    echo,
    SQLiteConnection
  };
}

afterEach(() => {
  vi.doUnmock('@capacitor-community/sqlite');
  vi.resetModules();
});

describe('capacitorAdapterHelpers', () => {
  describe('isIgnorableDeleteDbError', () => {
    it('returns true for known ignorable delete-db messages', async () => {
      const { module } = await loadHelpers();

      expect(
        module.isIgnorableDeleteDbError(new Error('Database not found'))
      ).toBe(true);
      expect(
        module.isIgnorableDeleteDbError(
          new Error('No Available Connection for tearleads')
        )
      ).toBe(true);
    });

    it('returns false for non-error and non-ignorable errors', async () => {
      const { module } = await loadHelpers();

      expect(module.isIgnorableDeleteDbError('not-an-error')).toBe(false);
      expect(module.isIgnorableDeleteDbError(new Error('permission denied'))).toBe(
        false
      );
    });
  });

  describe('getSQLiteConnection', () => {
    it('caches and reuses the same SQLiteConnection instance', async () => {
      const { module, echo, SQLiteConnection } = await loadHelpers();

      const first = await module.getSQLiteConnection();
      const second = await module.getSQLiteConnection();

      expect(first).toBe(second);
      expect(echo).toHaveBeenCalledTimes(1);
      expect(SQLiteConnection).toHaveBeenCalledTimes(1);
    });

    it('creates a new connection after cache reset', async () => {
      const { module, SQLiteConnection } = await loadHelpers();

      const first = await module.getSQLiteConnection();
      module.resetSQLiteConnectionCache();
      const second = await module.getSQLiteConnection();

      expect(first).not.toBe(second);
      expect(SQLiteConnection).toHaveBeenCalledTimes(2);
    });

    it('throws an actionable plugin init error when Capacitor plugin is null', async () => {
      const { module, SQLiteConnection } = await loadHelpers(
        new Error('CapacitorSQLitePlugin: null')
      );

      await expect(module.getSQLiteConnection()).rejects.toThrow(
        'SQLite plugin failed to initialize'
      );
      expect(SQLiteConnection).not.toHaveBeenCalled();
    });

    it('rethrows non-plugin echo errors', async () => {
      const echoError = new Error('Echo failed for unknown reason');
      const { module, SQLiteConnection } = await loadHelpers(echoError);

      await expect(module.getSQLiteConnection()).rejects.toThrow(
        'Echo failed for unknown reason'
      );
      expect(SQLiteConnection).not.toHaveBeenCalled();
    });
  });
});
