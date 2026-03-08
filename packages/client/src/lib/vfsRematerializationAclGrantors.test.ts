import '../test/setupIntegration';

import { mockConsoleWarn, resetTestKeyManager } from '@tearleads/db-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabaseAdapter, resetDatabase, setupDatabase } from '@/db';
import { ensureGrantorUsersExist } from './vfsRematerializationAclGrantors';

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';

describe('vfsRematerializationAclGrantors', () => {
  let warnSpy: ReturnType<typeof mockConsoleWarn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    warnSpy = mockConsoleWarn();
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns early when no grantor ids are provided', async () => {
    const adapter = getDatabaseAdapter();
    await expect(ensureGrantorUsersExist([], 50)).resolves.toBeUndefined();
    const rows = await adapter.execute(`SELECT id FROM users`, []);
    expect(rows.rows).toEqual([]);
  });

  it('creates placeholder users for missing grantors', async () => {
    const adapter = getDatabaseAdapter();

    await ensureGrantorUsersExist(['grantor-a', 'grantor-a', 'grantor-b'], 1);

    const rows = await adapter.execute(
      `SELECT id, email, email_confirmed FROM users ORDER BY id`,
      []
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: 'grantor-a',
        email: 'vfs-bootstrap+grantor-a@tearleads.local',
        email_confirmed: 0
      }),
      expect.objectContaining({
        id: 'grantor-b',
        email: 'vfs-bootstrap+grantor-b@tearleads.local',
        email_confirmed: 0
      })
    ]);
  });

  it('does not overwrite existing user records', async () => {
    const adapter = getDatabaseAdapter();
    await adapter.execute(
      `INSERT INTO users (id, email, email_confirmed) VALUES (?, ?, ?)`,
      ['existing-user', 'existing@example.com', 1]
    );

    await ensureGrantorUsersExist(['existing-user', 'new-user'], 200);

    const rows = await adapter.execute(
      `SELECT id, email, email_confirmed FROM users WHERE id IN (?, ?) ORDER BY id`,
      ['existing-user', 'new-user']
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: 'existing-user',
        email: 'existing@example.com',
        email_confirmed: 1
      }),
      expect.objectContaining({
        id: 'new-user',
        email: 'vfs-bootstrap+new-user@tearleads.local',
        email_confirmed: 0
      })
    ]);
  });

  it('returns without inserts when every grantor already exists', async () => {
    const adapter = getDatabaseAdapter();
    await adapter.execute(
      `INSERT INTO users (id, email, email_confirmed) VALUES (?, ?, ?)`,
      ['existing-only', 'existing-only@example.com', 1]
    );

    const executeSpy = vi.spyOn(adapter, 'execute');

    await ensureGrantorUsersExist(['existing-only', 'existing-only'], 200);

    expect(
      executeSpy.mock.calls.some(
        ([sql]) =>
          sql.startsWith(`INSERT INTO users`) ||
          sql.startsWith(`INSERT INTO organizations`)
      )
    ).toBe(false);
  });

  it('returns early when users table is unavailable', async () => {
    const adapter = getDatabaseAdapter();
    const executeSpy = vi
      .spyOn(adapter, 'execute')
      .mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes(`sqlite_master`) && params[0] === 'users') {
          return { rows: [], changes: 0, lastInsertRowId: 0 };
        }
        return { rows: [], changes: 0, lastInsertRowId: 0 };
      });

    await expect(
      ensureGrantorUsersExist(['user-without-table'], 200)
    ).resolves.toBeUndefined();

    expect(executeSpy).toHaveBeenCalledWith(
      expect.stringContaining(`sqlite_master`),
      ['users']
    );
  });

  it('uses personal-organization inserts when schema requires it', async () => {
    const adapter = getDatabaseAdapter();
    const originalExecute = adapter.execute.bind(adapter);
    const executeSpy = vi
      .spyOn(adapter, 'execute')
      .mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('PRAGMA table_info("users")')) {
          return {
            rows: [{ name: 'personal_organization_id', notnull: '1' }],
            changes: 0,
            lastInsertRowId: 0
          };
        }
        if (
          sql.includes(`SELECT name FROM sqlite_master`) &&
          params[0] === 'organizations'
        ) {
          return {
            rows: [{ name: 'organizations' }],
            changes: 0,
            lastInsertRowId: 0
          };
        }
        if (sql.startsWith(`INSERT INTO organizations`)) {
          return { rows: [], changes: 1, lastInsertRowId: 0 };
        }
        if (sql.startsWith(`INSERT INTO users`)) {
          return { rows: [], changes: 1, lastInsertRowId: 0 };
        }
        return originalExecute(sql, params);
      });

    await ensureGrantorUsersExist(['grantor-with-org'], 200);

    expect(
      executeSpy.mock.calls.some(([sql]) =>
        sql.startsWith(`INSERT INTO organizations`)
      )
    ).toBe(true);
    expect(
      executeSpy.mock.calls.some(([sql]) => sql.startsWith(`INSERT INTO users`))
    ).toBe(true);
  });

  it('supports numeric notnull values from pragma table_info', async () => {
    const adapter = getDatabaseAdapter();
    const originalExecute = adapter.execute.bind(adapter);
    const executeSpy = vi
      .spyOn(adapter, 'execute')
      .mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('PRAGMA table_info("users")')) {
          return {
            rows: [{ name: 'personal_organization_id', notnull: 1 }],
            changes: 0,
            lastInsertRowId: 0
          };
        }
        if (
          sql.includes(`SELECT name FROM sqlite_master`) &&
          params[0] === 'organizations'
        ) {
          return {
            rows: [{ name: 'organizations' }],
            changes: 0,
            lastInsertRowId: 0
          };
        }
        if (sql.startsWith(`INSERT INTO organizations`)) {
          return { rows: [], changes: 1, lastInsertRowId: 0 };
        }
        if (sql.startsWith(`INSERT INTO users`)) {
          return { rows: [], changes: 1, lastInsertRowId: 0 };
        }
        return originalExecute(sql, params);
      });

    await ensureGrantorUsersExist(['grantor-with-numeric-notnull'], 200);

    expect(
      executeSpy.mock.calls.some(([sql]) =>
        sql.startsWith(`INSERT INTO organizations`)
      )
    ).toBe(true);
    expect(
      executeSpy.mock.calls.some(([sql]) => sql.startsWith(`INSERT INTO users`))
    ).toBe(true);
  });

  it('falls back to base user inserts when pragma notnull is invalid text', async () => {
    const adapter = getDatabaseAdapter();
    const originalExecute = adapter.execute.bind(adapter);
    const executeSpy = vi
      .spyOn(adapter, 'execute')
      .mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('PRAGMA table_info("users")')) {
          return {
            rows: [{ name: 'personal_organization_id', notnull: 'not-a-number' }],
            changes: 0,
            lastInsertRowId: 0
          };
        }
        return originalExecute(sql, params);
      });

    await ensureGrantorUsersExist(['grantor-no-org-required'], 200);

    expect(
      executeSpy.mock.calls.some(([sql]) => sql.startsWith(`INSERT INTO users`))
    ).toBe(true);
    expect(
      executeSpy.mock.calls.some(([sql]) =>
        sql.startsWith(`INSERT INTO organizations`)
      )
    ).toBe(false);
  });
});
