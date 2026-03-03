/**
 * Tests for SQLite WASM initialization and SQLITE_NOTADB recovery flow.
 *
 * Uses vi.resetModules() + vi.doMock() + dynamic import() so each test gets
 * a fresh copy of the module-level state (db, encryptionKey, etc.).
 * Same pattern as pingContract.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SQLiteDatabase } from './types';

type InitModule = typeof import('./init');

async function loadInitModule(): Promise<InitModule> {
  return import('./init');
}

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

/** Minimal mock DB that tracks close() calls and can throw on exec(). */
function createMockDb(options?: {
  execThrows?: Error;
  execThrowOnce?: boolean;
}): SQLiteDatabase {
  let threw = false;
  return {
    exec: vi.fn((sql: unknown) => {
      // Only throw on the verification query ("SELECT 1;"), not on PRAGMA.
      if (
        options?.execThrows &&
        typeof sql === 'string' &&
        sql === 'SELECT 1;'
      ) {
        if (options.execThrowOnce && threw) return;
        threw = true;
        throw options.execThrows;
      }
    }),
    close: vi.fn(),
    changes: vi.fn(() => 0),
    pointer: 1
  } as unknown as SQLiteDatabase;
}

/**
 * Build a mock sqlite3 module whose DB constructor delegates to `dbFactory`.
 *
 * Uses a real function constructor (not an arrow function) because the
 * production code calls `new sqlite3.oo1.DB(...)`. Arrow functions cannot
 * be used as constructors — `new` throws "is not a constructor".
 */
function createMockSqlite3(
  dbFactory: (opts: {
    filename: string;
    flags: string;
    hexkey?: string;
  }) => SQLiteDatabase
) {
  function MockDB(
    this: unknown,
    opts: { filename: string; flags: string; hexkey?: string }
  ) {
    return dbFactory(opts);
  }
  return {
    oo1: { DB: MockDB },
    capi: {
      sqlite3_libversion: () => '3.0.0-mock',
      sqlite3_js_vfs_list: () => []
    },
    wasm: { exports: { memory: {} } }
  };
}

/** Dummy encryption key (32 bytes of zeros). */
const TEST_KEY = new Uint8Array(32);

/**
 * Standard set of doMock calls shared by most tests.
 * - sqlite3InitModule resolves to `sqlite3Mock`
 * - VFS helpers report no OPFS (in-memory fallback — simplifies tests)
 * - keyToHex returns a deterministic hex string
 */
function applyStandardMocks(sqlite3Mock: ReturnType<typeof createMockSqlite3>) {
  // Mock the WASM init module — returns our controllable sqlite3 instance.
  vi.doMock('@/workers/sqlite-wasm/sqlite3.js', () => ({
    default: () => Promise.resolve(sqlite3Mock)
  }));

  // Mock VFS utilities — no OPFS available, so the module uses in-memory.
  // This avoids needing real OPFS infrastructure in unit tests.
  vi.doMock('./vfs', () => ({
    installOpfsVfs: () => Promise.resolve(false),
    getOpfsVfsName: () => null,
    getVfsList: () => [],
    ensureMultipleciphersVfs: () => false
  }));

  // Mock keyToHex — return a predictable hex string so we can assert on it.
  vi.doMock('./operations', () => ({
    keyToHex: () => 'deadbeef'
  }));
}

// ---------------------------------------------------------------------------
// Mock for navigator.storage.getDirectory (OPFS root)
// ---------------------------------------------------------------------------

/** Stub OPFS root that records removeEntry calls. */
function installOpfsMock() {
  const removedEntries: string[] = [];
  const opfsRoot = {
    removeEntry: vi.fn(async (name: string) => {
      removedEntries.push(name);
    })
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      storage: {
        getDirectory: vi.fn(() => Promise.resolve(opfsRoot))
      }
    },
    writable: true,
    configurable: true
  });
  return { opfsRoot, removedEntries };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initializeDatabase', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  // ---- 1. Happy path ----
  it('succeeds on first attempt when the database is healthy', async () => {
    const mockDb = createMockDb();
    const sqlite3 = createMockSqlite3(() => mockDb);
    applyStandardMocks(sqlite3);

    const {
      initializeDatabase,
      getDb,
      getEncryptionKey,
      getCurrentDbFilename
    } = await loadInitModule();

    await initializeDatabase('test-db', TEST_KEY);

    // DB is open and state variables are set.
    expect(getDb()).toBe(mockDb);
    expect(getEncryptionKey()).toBe('deadbeef');
    expect(getCurrentDbFilename()).toBe('test-db.sqlite3');
    // Verification query was called.
    expect(mockDb.exec).toHaveBeenCalledWith('SELECT 1;');
  });

  // ---- 2. SQLITE_NOTADB recovery (the bug this PR fixes) ----
  //
  // Scenario: OPFS file survives "Clear browsing data" but the encryption key
  // (stored elsewhere) is wiped. The app derives a new key, tries to open the
  // stale file, and gets SQLITE_NOTADB. The recovery path must:
  //   a) close the broken handle
  //   b) delete the stale OPFS file
  //   c) retry openDatabase() with the SAME key and filename
  //
  // Before the fix, closeDatabase() nulled encryptionKey/currentDbFilename,
  // so the retry hit "Database initialization state is invalid".
  it('recovers from SQLITE_NOTADB by deleting the stale file and retrying', async () => {
    // Mock console.warn/error — the recovery path logs warnings that are
    // expected behavior, not test failures.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installOpfsMock();

    let attempt = 0;
    const healthyDb = createMockDb();
    const sqlite3 = createMockSqlite3(() => {
      attempt++;
      if (attempt === 1) {
        // First attempt: DB constructor succeeds but SELECT 1 fails —
        // the file exists but is encrypted with a different (now-lost) key.
        return createMockDb({
          execThrows: new Error('SQLITE_NOTADB: file is not a database'),
          execThrowOnce: true
        });
      }
      // Second attempt (after deleting the stale file): success.
      return healthyDb;
    });
    applyStandardMocks(sqlite3);

    const {
      initializeDatabase,
      getDb,
      getEncryptionKey,
      getCurrentDbFilename
    } = await loadInitModule();

    // Should succeed — the recovery path deletes and retries.
    await initializeDatabase('test-db', TEST_KEY);

    // The retry produced a healthy DB with the correct state preserved.
    expect(getDb()).toBe(healthyDb);
    expect(getEncryptionKey()).toBe('deadbeef');
    expect(getCurrentDbFilename()).toBe('test-db.sqlite3');
    expect(attempt).toBe(2);
  });

  // ---- 3. Persistent failure ----
  it('propagates the error when both attempts fail with SQLITE_NOTADB', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installOpfsMock();

    const sqlite3 = createMockSqlite3(() =>
      createMockDb({
        execThrows: new Error('SQLITE_NOTADB: file is not a database')
      })
    );
    applyStandardMocks(sqlite3);

    const { initializeDatabase } = await loadInitModule();

    // Both attempts fail — the error should propagate with a descriptive message.
    await expect(initializeDatabase('test-db', TEST_KEY)).rejects.toThrow(
      'Failed to open encrypted database'
    );
  });

  // ---- 4. Non-NOTADB error ----
  it('propagates non-NOTADB errors immediately without recovery', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const sqlite3 = createMockSqlite3(() =>
      createMockDb({
        execThrows: new Error('SQLITE_IOERR: disk I/O error')
      })
    );
    applyStandardMocks(sqlite3);

    const { initializeDatabase } = await loadInitModule();

    // Non-NOTADB errors skip the recovery path entirely.
    await expect(initializeDatabase('test-db', TEST_KEY)).rejects.toThrow(
      'SQLITE_IOERR'
    );
  });

  // ---- 5. closeDatabase clears state ----
  it('closeDatabase clears db, encryptionKey, and currentDbFilename', async () => {
    const mockDb = createMockDb();
    const sqlite3 = createMockSqlite3(() => mockDb);
    applyStandardMocks(sqlite3);

    const {
      initializeDatabase,
      closeDatabase,
      getDb,
      getEncryptionKey,
      getCurrentDbFilename
    } = await loadInitModule();

    await initializeDatabase('test-db', TEST_KEY);
    expect(getDb()).toBe(mockDb);

    // Normal close: all sensitive state must be wiped for security.
    closeDatabase();
    expect(getDb()).toBeNull();
    expect(getEncryptionKey()).toBeNull();
    expect(getCurrentDbFilename()).toBeNull();
    expect(mockDb.close).toHaveBeenCalled();
  });
});
