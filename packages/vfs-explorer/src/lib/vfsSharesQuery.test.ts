import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDatabase } from '../test/testUtils';
import type { VfsSortState } from './vfsTypes';

describe('vfsSharesQuery', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  describe('querySharedByMe', () => {
    it('calls the complete query chain and returns rows', async () => {
      const { querySharedByMe } = await import('./vfsSharesQuery');

      const mockRows = [
        {
          id: 'item-1',
          objectType: 'folder',
          name: 'Shared Folder',
          createdAt: new Date(),
          shareId: 'share-1',
          targetId: 'user-2',
          targetName: 'user-2',
          shareType: 'user',
          permissionLevel: 'view',
          sharedAt: new Date(),
          expiresAt: null
        }
      ];
      mockDb.orderBy.mockResolvedValueOnce(mockRows);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await querySharedByMe(
        mockDb as never,
        'current-user',
        sort
      );

      expect(result).toEqual(mockRows);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.innerJoin).toHaveBeenCalled();
      expect(mockDb.leftJoin).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('returns empty array when user has not shared anything', async () => {
      const { querySharedByMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await querySharedByMe(
        mockDb as never,
        'current-user',
        sort
      );

      expect(result).toEqual([]);
    });

    it('propagates database errors', async () => {
      const { querySharedByMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockRejectedValueOnce(new Error('DB failure'));

      const sort: VfsSortState = { column: null, direction: null };
      await expect(
        querySharedByMe(mockDb as never, 'current-user', sort)
      ).rejects.toThrow('DB failure');
    });

    it('works with name sort ascending', async () => {
      const { querySharedByMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'name', direction: 'asc' };
      await querySharedByMe(mockDb as never, 'current-user', sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('works with createdAt sort descending', async () => {
      const { querySharedByMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'createdAt', direction: 'desc' };
      await querySharedByMe(mockDb as never, 'current-user', sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('works with objectType sort', async () => {
      const { querySharedByMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'objectType', direction: 'asc' };
      await querySharedByMe(mockDb as never, 'current-user', sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('uses innerJoin for vfsRegistry', async () => {
      const { querySharedByMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      await querySharedByMe(mockDb as never, 'current-user', sort);

      expect(mockDb.innerJoin).toHaveBeenCalled();
    });
  });

  describe('querySharedWithMe', () => {
    it('calls the complete query chain and returns rows', async () => {
      const { querySharedWithMe } = await import('./vfsSharesQuery');

      const mockRows = [
        {
          id: 'item-1',
          objectType: 'note',
          name: 'Shared Note',
          createdAt: new Date(),
          shareId: 'share-1',
          sharedById: 'user-1',
          sharedByEmail: 'user1@example.com',
          shareType: 'user',
          permissionLevel: 'edit',
          sharedAt: new Date(),
          expiresAt: null
        }
      ];
      mockDb.orderBy.mockResolvedValueOnce(mockRows);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await querySharedWithMe(
        mockDb as never,
        'current-user',
        sort
      );

      expect(result).toEqual(mockRows);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.innerJoin).toHaveBeenCalled();
      expect(mockDb.leftJoin).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('returns empty array when nothing is shared with user', async () => {
      const { querySharedWithMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await querySharedWithMe(
        mockDb as never,
        'current-user',
        sort
      );

      expect(result).toEqual([]);
    });

    it('propagates database errors', async () => {
      const { querySharedWithMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockRejectedValueOnce(new Error('DB failure'));

      const sort: VfsSortState = { column: null, direction: null };
      await expect(
        querySharedWithMe(mockDb as never, 'current-user', sort)
      ).rejects.toThrow('DB failure');
    });

    it('works with name sort descending', async () => {
      const { querySharedWithMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'name', direction: 'desc' };
      await querySharedWithMe(mockDb as never, 'current-user', sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('uses innerJoin for users table', async () => {
      const { querySharedWithMe } = await import('./vfsSharesQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      await querySharedWithMe(mockDb as never, 'current-user', sort);

      // querySharedWithMe uses innerJoin twice (vfsRegistry and users)
      expect(mockDb.innerJoin).toHaveBeenCalled();
    });
  });
});
