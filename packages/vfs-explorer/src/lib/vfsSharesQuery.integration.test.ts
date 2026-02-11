import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { describe, expect, it, vi } from 'vitest';
import { querySharedByMe } from './vfsSharesQuery';

describe('vfsSharesQuery integration (real database)', () => {
  it('returns empty results when vfs_shares table is unavailable', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await withRealDatabase(
      async ({ db }) => {
        const rows = await querySharedByMe(db, 'user-1', {
          column: null,
          direction: null
        });

        expect(rows).toEqual([]);
      },
      { migrations: vfsTestMigrations }
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing required table "vfs_shares"'),
      expect.anything()
    );
    consoleErrorSpy.mockRestore();
  });
});
