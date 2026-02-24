import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDatabase } from '../test/testUtils';
import type { VfsSortState } from './vfsTypes';

// The query functions chain: select → from → innerJoin/leftJoin → where → orderBy
// Our mock DB returns `this` for all chainable methods and resolves at `orderBy`.

describe('vfsQuery', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  describe('queryFolderContents', () => {
    it('calls the complete query chain and returns rows', async () => {
      const { queryFolderContents } = await import('./vfsQuery');

      const mockRows = [
        {
          id: 'item-1',
          linkId: 'link-1',
          objectType: 'folder',
          name: 'Folder A',
          createdAt: new Date()
        },
        {
          id: 'item-2',
          linkId: 'link-2',
          objectType: 'note',
          name: 'Note B',
          createdAt: new Date()
        }
      ];
      mockDb.orderBy.mockResolvedValueOnce(mockRows);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryFolderContents(
        mockDb as never,
        'parent-id',
        sort
      );

      expect(result).toEqual(mockRows);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.innerJoin).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('returns empty array when folder has no contents', async () => {
      const { queryFolderContents } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryFolderContents(
        mockDb as never,
        'empty-folder',
        sort
      );

      expect(result).toEqual([]);
    });

    it('propagates database errors', async () => {
      const { queryFolderContents } = await import('./vfsQuery');

      mockDb.orderBy.mockRejectedValueOnce(new Error('DB failure'));

      const sort: VfsSortState = { column: null, direction: null };
      await expect(
        queryFolderContents(mockDb as never, 'folder-1', sort)
      ).rejects.toThrow('DB failure');
    });

    it('works with name sort ascending', async () => {
      const { queryFolderContents } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'name', direction: 'asc' };
      await queryFolderContents(mockDb as never, 'folder-1', sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('works with createdAt sort descending', async () => {
      const { queryFolderContents } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'createdAt', direction: 'desc' };
      await queryFolderContents(mockDb as never, 'folder-1', sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('works with objectType sort', async () => {
      const { queryFolderContents } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'objectType', direction: 'asc' };
      await queryFolderContents(mockDb as never, 'folder-1', sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('uses innerJoin for vfsLinks', async () => {
      const { queryFolderContents } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      await queryFolderContents(mockDb as never, 'folder-1', sort);

      // Folder contents uses innerJoin on vfsLinks (not just leftJoin)
      expect(mockDb.innerJoin).toHaveBeenCalled();
    });
  });

  describe('queryUnfiledItems', () => {
    it('calls the complete query chain and returns rows', async () => {
      const { queryUnfiledItems } = await import('./vfsQuery');

      const mockRows = [
        {
          id: 'item-1',
          objectType: 'folder',
          name: 'Orphan Folder',
          createdAt: new Date()
        }
      ];
      mockDb.orderBy.mockResolvedValueOnce(mockRows);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryUnfiledItems(mockDb as never, sort);

      expect(result).toEqual(mockRows);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('does not use innerJoin (uses leftJoin for vfsLinks filtering)', async () => {
      const { queryUnfiledItems } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      await queryUnfiledItems(mockDb as never, sort);

      // Unfiled items uses leftJoin (not innerJoin) to find items with no links
      expect(mockDb.innerJoin).not.toHaveBeenCalled();
    });

    it('returns empty array when no unfiled items', async () => {
      const { queryUnfiledItems } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryUnfiledItems(mockDb as never, sort);

      expect(result).toEqual([]);
    });

    it('propagates database errors', async () => {
      const { queryUnfiledItems } = await import('./vfsQuery');

      mockDb.orderBy.mockRejectedValueOnce(new Error('DB failure'));

      const sort: VfsSortState = { column: null, direction: null };
      await expect(queryUnfiledItems(mockDb as never, sort)).rejects.toThrow(
        'DB failure'
      );
    });
  });

  describe('queryAllItems', () => {
    it('calls the complete query chain and returns rows', async () => {
      const { queryAllItems } = await import('./vfsQuery');

      const mockRows = [
        {
          id: 'item-1',
          objectType: 'folder',
          name: 'Folder A',
          createdAt: new Date()
        },
        {
          id: 'item-2',
          objectType: 'contact',
          name: 'John Doe',
          createdAt: new Date()
        }
      ];
      mockDb.orderBy.mockResolvedValueOnce(mockRows);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryAllItems(mockDb as never, sort);

      expect(result).toEqual(mockRows);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('does not use innerJoin', async () => {
      const { queryAllItems } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      await queryAllItems(mockDb as never, sort);

      expect(mockDb.innerJoin).not.toHaveBeenCalled();
    });

    it('returns empty array when no items exist', async () => {
      const { queryAllItems } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryAllItems(mockDb as never, sort);

      expect(result).toEqual([]);
    });

    it('propagates database errors', async () => {
      const { queryAllItems } = await import('./vfsQuery');

      mockDb.orderBy.mockRejectedValueOnce(new Error('DB failure'));

      const sort: VfsSortState = { column: null, direction: null };
      await expect(queryAllItems(mockDb as never, sort)).rejects.toThrow(
        'DB failure'
      );
    });

    it('works with name sort descending', async () => {
      const { queryAllItems } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: 'name', direction: 'desc' };
      await queryAllItems(mockDb as never, sort);

      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  describe('queryDeletedItems', () => {
    it('calls the complete query chain and returns rows', async () => {
      const { queryDeletedItems } = await import('./vfsQuery');

      const mockRows = [
        {
          id: 'item-1',
          objectType: 'file',
          name: 'Deleted File',
          createdAt: new Date()
        }
      ];
      mockDb.orderBy.mockResolvedValueOnce(mockRows);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryDeletedItems(mockDb as never, sort);

      expect(result).toEqual(mockRows);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('returns empty array when no deleted items exist', async () => {
      const { queryDeletedItems } = await import('./vfsQuery');

      mockDb.orderBy.mockResolvedValueOnce([]);

      const sort: VfsSortState = { column: null, direction: null };
      const result = await queryDeletedItems(mockDb as never, sort);

      expect(result).toEqual([]);
    });

    it('propagates database errors', async () => {
      const { queryDeletedItems } = await import('./vfsQuery');

      mockDb.orderBy.mockRejectedValueOnce(new Error('DB failure'));

      const sort: VfsSortState = { column: null, direction: null };
      await expect(queryDeletedItems(mockDb as never, sort)).rejects.toThrow(
        'DB failure'
      );
    });
  });
});
