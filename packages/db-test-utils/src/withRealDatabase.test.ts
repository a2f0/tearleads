import { describe, expect, it } from 'vitest';
import type { DatabaseAdapter } from './adapters/types.js';
import { createTestDatabase, withRealDatabase } from './withRealDatabase.js';

describe('createTestDatabase', () => {
  it('creates database context with adapter, db, and keyManager', async () => {
    const context = await createTestDatabase();
    try {
      expect(context.adapter).toBeDefined();
      expect(context.db).toBeDefined();
      expect(context.keyManager).toBeDefined();
      expect(context.adapter.isOpen()).toBe(true);
    } finally {
      await context.adapter.close();
    }
  });

  it('respects skipEncryption option', async () => {
    const context = await createTestDatabase({ skipEncryption: true });
    try {
      expect(context.adapter.isOpen()).toBe(true);
    } finally {
      await context.adapter.close();
    }
  });

  it('respects instanceId option', async () => {
    const context = await createTestDatabase({ instanceId: 'custom-instance' });
    try {
      expect(context.adapter.isOpen()).toBe(true);
    } finally {
      await context.adapter.close();
    }
  });

  it('runs migrations when provided', async () => {
    const migrations = [
      {
        version: 1,
        up: async (adapter: DatabaseAdapter) => {
          await adapter.execute(`
            CREATE TABLE IF NOT EXISTS test_table (
              id TEXT PRIMARY KEY,
              name TEXT
            )
          `);
        }
      }
    ];

    const context = await createTestDatabase({ migrations });
    try {
      const result = await context.adapter.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(result.rows.length).toBe(1);
    } finally {
      await context.adapter.close();
    }
  });
});

describe('withRealDatabase', () => {
  it('provides database context to callback', async () => {
    await withRealDatabase(async ({ db, adapter, keyManager }) => {
      expect(db).toBeDefined();
      expect(adapter).toBeDefined();
      expect(keyManager).toBeDefined();
      expect(adapter.isOpen()).toBe(true);
    });
  });

  it('returns callback result', async () => {
    const result = await withRealDatabase(async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('closes adapter after callback completes', async () => {
    let capturedAdapter: DatabaseAdapter | undefined;

    await withRealDatabase(async ({ adapter }) => {
      capturedAdapter = adapter;
      expect(adapter.isOpen()).toBe(true);
    });

    expect(capturedAdapter).toBeDefined();
    // Use explicit type check after vitest assertion
    if (capturedAdapter) {
      expect(capturedAdapter.isOpen()).toBe(false);
    }
  });

  it('closes adapter even if callback throws', async () => {
    let capturedAdapter: DatabaseAdapter | undefined;

    await expect(
      withRealDatabase(async ({ adapter }) => {
        capturedAdapter = adapter;
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');

    expect(capturedAdapter).toBeDefined();
    // Use explicit type check after vitest assertion
    if (capturedAdapter) {
      expect(capturedAdapter.isOpen()).toBe(false);
    }
  });

  it('allows database operations', async () => {
    const migrations = [
      {
        version: 1,
        up: async (adapter: DatabaseAdapter) => {
          await adapter.execute(`
            CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)
          `);
        }
      }
    ];

    await withRealDatabase(
      async ({ adapter }) => {
        await adapter.execute(
          "INSERT INTO users (id, name) VALUES ('1', 'John')"
        );
        const result = await adapter.execute('SELECT * FROM users');
        expect(result.rows.length).toBe(1);
      },
      { migrations }
    );
  });
});
