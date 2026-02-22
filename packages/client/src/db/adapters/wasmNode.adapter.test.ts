import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleWarn } from '@/test/consoleMocks';

const TEST_KEY = new Uint8Array([1, 2, 3, 4]);

const createConfig = (name: string) => ({
  name,
  encryptionKey: TEST_KEY
});

describe('WasmNodeAdapter', () => {
  type WasmNodeAdapterClass =
    typeof import('./wasmNode.adapter').WasmNodeAdapter;
  type WasmNodeAdapterInstance = InstanceType<WasmNodeAdapterClass>;

  let WasmNodeAdapter: WasmNodeAdapterClass;
  let adapter: WasmNodeAdapterInstance;
  let warnSpy: ReturnType<typeof mockConsoleWarn>;

  beforeEach(async () => {
    const module = await import('./wasmNode.adapter');
    WasmNodeAdapter = module.WasmNodeAdapter;
    warnSpy = mockConsoleWarn();
    adapter = new WasmNodeAdapter({ skipEncryption: true });
  });

  afterEach(async () => {
    if (adapter.isOpen()) {
      await adapter.close();
    }
    warnSpy.mockRestore();
  });

  it('initializes once and rejects double initialization', async () => {
    await adapter.initialize(createConfig('init-once'));

    await expect(
      adapter.initialize(createConfig('init-twice'))
    ).rejects.toThrow('Database already initialized');
  });

  it('executes select and non-select queries', async () => {
    await adapter.initialize(createConfig('query-test'));

    await adapter.execute(
      'CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)'
    );
    const insertResult = await adapter.execute(
      'INSERT INTO test (value) VALUES (?)',
      ['hello']
    );

    expect(insertResult.changes).toBe(1);
    expect(insertResult.lastInsertRowId).toBeGreaterThan(0);

    const selectResult = await adapter.execute(
      'SELECT value FROM test WHERE id = ?',
      [insertResult.lastInsertRowId]
    );

    expect(selectResult.rows).toHaveLength(1);
    expect(selectResult.rows[0]?.['value']).toBe('hello');
  });

  it('executes statements in a transaction and rolls back on error', async () => {
    await adapter.initialize(createConfig('execute-many'));

    await expect(
      adapter.executeMany([
        'CREATE TABLE rollback_test (id INTEGER PRIMARY KEY, value TEXT)',
        "INSERT INTO rollback_test (value) VALUES ('ok')",
        'INVALID SQL'
      ])
    ).rejects.toBeDefined();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='rollback_test'"
    );
    expect(result.rows).toHaveLength(0);
  });

  it('commits explicit transactions', async () => {
    await adapter.initialize(createConfig('commit-tx'));

    await adapter.beginTransaction();
    await adapter.execute('CREATE TABLE commit_test (id INTEGER PRIMARY KEY)');
    await adapter.commitTransaction();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='commit_test'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('supports explicit transaction helpers', async () => {
    await adapter.initialize(createConfig('tx-helpers'));

    await adapter.beginTransaction();
    await adapter.execute('CREATE TABLE tx_test (id INTEGER PRIMARY KEY)');
    await adapter.rollbackTransaction();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tx_test'"
    );
    expect(result.rows).toHaveLength(0);
  });

  it('handles rekeying when encryption is skipped', async () => {
    await adapter.initialize(createConfig('rekey-skip'));
    await adapter.rekeyDatabase(new Uint8Array([9, 8, 7, 6]));
  });

  it('throws when rekeying before initialization', async () => {
    await expect(
      adapter.rekeyDatabase(new Uint8Array([9, 8, 7, 6]))
    ).rejects.toThrow('Database not initialized');
  });

  it('rekeys database when encryption is enabled', async () => {
    const encryptedAdapter = new WasmNodeAdapter();
    await encryptedAdapter.initialize(createConfig('rekey-enabled'));
    await encryptedAdapter.rekeyDatabase(new Uint8Array([6, 7, 8, 9]));
    await encryptedAdapter.close();
  });

  it('returns sqlite-proxy compatible rows via getConnection', async () => {
    await adapter.initialize(createConfig('proxy'));
    await adapter.execute('CREATE TABLE proxy_test (id INTEGER, value TEXT)');
    await adapter.execute('INSERT INTO proxy_test (id, value) VALUES (?, ?)', [
      7,
      'row'
    ]);

    const connection = adapter.getConnection();
    if (typeof connection !== 'function') {
      throw new Error('Expected connection to be a function');
    }

    const result = await connection(
      'SELECT id, value FROM proxy_test ORDER BY id',
      [],
      'all'
    );

    expect(result.rows).toEqual([[7, 'row']]);
  });

  it('throws when executing before initialization', async () => {
    await expect(adapter.execute('SELECT 1')).rejects.toThrow(
      'Database not initialized'
    );
  });

  it('defaults lastInsertRowId when sqlite returns no rows', async () => {
    const fakeDb = {
      exec: vi.fn((arg: string | { sql: string }) => {
        if (typeof arg === 'string') {
          return undefined;
        }
        if (arg.sql === 'SELECT last_insert_rowid()') {
          return [];
        }
        return undefined;
      }),
      changes: vi.fn(() => 0),
      close: vi.fn(() => undefined)
    };

    Object.defineProperty(adapter, 'db', {
      value: fakeDb,
      writable: true
    });

    const result = await adapter.execute('UPDATE test SET value = 1');

    expect(result.lastInsertRowId).toBe(0);
  });

  it('throws when executing many before initialization', async () => {
    await expect(adapter.executeMany(['SELECT 1'])).rejects.toThrow(
      'Database not initialized'
    );
  });
});
