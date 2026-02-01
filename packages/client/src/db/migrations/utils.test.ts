import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { addColumnIfNotExists, tableExists } from './utils';

const createAdapter = (
  execute: DatabaseAdapter['execute']
): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute,
  executeMany: vi.fn(async () => {}),
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => null),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('addColumnIfNotExists', () => {
  it('adds the column when it is missing', async () => {
    const execute = vi.fn<DatabaseAdapter['execute']>().mockResolvedValueOnce({
      rows: [{ name: 'existing_col' }]
    });

    await addColumnIfNotExists(
      createAdapter(execute),
      'test_table',
      'new_col',
      'TEXT'
    );

    expect(execute).toHaveBeenCalledWith('PRAGMA table_info("test_table")');
    expect(execute).toHaveBeenCalledWith(
      'ALTER TABLE "test_table" ADD COLUMN "new_col" TEXT'
    );
  });

  it('does not add the column when it already exists', async () => {
    const execute = vi.fn<DatabaseAdapter['execute']>().mockResolvedValueOnce({
      rows: [{ name: 'existing_col' }, { name: 'new_col' }]
    });

    await addColumnIfNotExists(
      createAdapter(execute),
      'test_table',
      'new_col',
      'TEXT'
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when the PRAGMA query fails', async () => {
    const execute = vi
      .fn<DatabaseAdapter['execute']>()
      .mockRejectedValueOnce(new Error('No PRAGMA'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await addColumnIfNotExists(
      createAdapter(execute),
      'test_table',
      'new_col',
      'TEXT'
    );

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('tableExists', () => {
  it('returns true when the table exists', async () => {
    const execute = vi.fn<DatabaseAdapter['execute']>().mockResolvedValueOnce({
      rows: [{ '1': 1 }]
    });

    const result = await tableExists(createAdapter(execute), 'my_table');

    expect(result).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
      ['my_table']
    );
  });

  it('returns false when the table does not exist', async () => {
    const execute = vi.fn<DatabaseAdapter['execute']>().mockResolvedValueOnce({
      rows: []
    });

    const result = await tableExists(createAdapter(execute), 'missing_table');

    expect(result).toBe(false);
    expect(execute).toHaveBeenCalledWith(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
      ['missing_table']
    );
  });

  it('returns false when result is null or undefined', async () => {
    const execute = vi
      .fn<DatabaseAdapter['execute']>()
      .mockResolvedValueOnce(
        null as unknown as { rows: Record<string, unknown>[] }
      );

    const result = await tableExists(createAdapter(execute), 'test_table');

    expect(result).toBe(false);
  });
});
