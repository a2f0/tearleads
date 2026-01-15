import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { addColumnIfNotExists } from './utils';

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
