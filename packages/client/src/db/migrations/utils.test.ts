import { describe, expect, it, vi } from 'vitest';
import { addColumnIfNotExists } from './utils';

describe('addColumnIfNotExists', () => {
  it('adds the column when it is missing', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [{ name: 'existing_col' }]
    });

    await addColumnIfNotExists(
      { execute } as { execute: typeof execute },
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
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [{ name: 'existing_col' }, { name: 'new_col' }]
    });

    await addColumnIfNotExists(
      { execute } as { execute: typeof execute },
      'test_table',
      'new_col',
      'TEXT'
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when the PRAGMA query fails', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error('No PRAGMA'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await addColumnIfNotExists(
      { execute } as { execute: typeof execute },
      'test_table',
      'new_col',
      'TEXT'
    );

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
