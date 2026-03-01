import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v028 } from './v028';

const createAdapter = (
  executeMany: DatabaseAdapter['executeMany'],
  execute: DatabaseAdapter['execute']
): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute,
  executeMany,
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v028 migration', () => {
  it('creates policy and ACL provenance tables with indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const execute = vi.fn<DatabaseAdapter['execute']>();
    const adapter = createAdapter(executeMany, execute);

    await v028.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(
      statements.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS "vfs_share_policies"')
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          'CREATE TABLE IF NOT EXISTS "vfs_share_policy_selectors"'
        )
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          'CREATE TABLE IF NOT EXISTS "vfs_share_policy_principals"'
        )
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          'CREATE TABLE IF NOT EXISTS "vfs_acl_entry_provenance"'
        )
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('vfs_share_policy_selectors_policy_order_idx')
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('vfs_share_policy_principals_unique_idx')
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('vfs_acl_entry_provenance_source_idx')
      )
    ).toBe(true);
  });

  it('has correct version and description', () => {
    expect(v028.version).toBe(28);
    expect(v028.description).toBe(
      'Add container share policy and ACL provenance schema'
    );
  });
});
