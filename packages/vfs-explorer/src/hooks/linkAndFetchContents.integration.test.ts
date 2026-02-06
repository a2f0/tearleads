import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useCopyVfsItem } from './useCopyVfsItem';
import { useVfsFolderContents } from './useVfsFolderContents';

vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'new-link-uuid')
});

describe('VFS Link Integration: Link Item and Fetch Folder Contents', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockFindFirst: ReturnType<typeof vi.fn>;
  let insertedLinkData: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedLinkData = null;

    // Track what gets inserted
    mockInsert = vi.fn(() => ({
      values: vi.fn((data) => {
        insertedLinkData = data;
        return Promise.resolve(undefined);
      })
    }));

    // Mock findFirst for checking existing links
    mockFindFirst = vi.fn().mockResolvedValue(null);

    mockDb = {
      ...createMockDatabase(),
      insert: mockInsert,
      query: {
        vfsLinks: {
          findFirst: mockFindFirst
        }
      }
    } as ReturnType<typeof createMockDatabase>;
  });

  it('creates a link with correct parentId and childId', async () => {
    const targetFolderId = 'folder-123';
    const itemId = 'item-456';

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result } = renderHook(() => useCopyVfsItem(), { wrapper });

    await act(async () => {
      await result.current.copyItem(itemId, targetFolderId);
    });

    // Verify the link was created with correct structure
    expect(insertedLinkData).toMatchObject({
      id: 'new-link-uuid',
      parentId: targetFolderId,
      childId: itemId
    });
  });

  it('verifies link structure matches folder contents query expectations', async () => {
    const targetFolderId = 'folder-123';
    const itemId = 'item-456';

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result } = renderHook(() => useCopyVfsItem(), { wrapper });

    await act(async () => {
      await result.current.copyItem(itemId, targetFolderId);
    });

    // The link should have:
    // - parentId: the folder we're linking TO
    // - childId: the item being linked
    // This matches how queryFolderContents queries:
    // WHERE vfsLinks.parentId = folderId
    // INNER JOIN vfsRegistry ON vfsLinks.childId = vfsRegistry.id
    expect(insertedLinkData).not.toBeNull();
    expect(insertedLinkData?.['parentId']).toBe(targetFolderId);
    expect(insertedLinkData?.['childId']).toBe(itemId);
  });

  it('skips creating link if one already exists', async () => {
    const targetFolderId = 'folder-123';
    const itemId = 'item-456';

    // Simulate existing link
    mockFindFirst.mockResolvedValue({
      id: 'existing-link',
      parentId: targetFolderId,
      childId: itemId
    });

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result } = renderHook(() => useCopyVfsItem(), { wrapper });

    await act(async () => {
      await result.current.copyItem(itemId, targetFolderId);
    });

    // Insert should not be called when link already exists
    expect(mockInsert).not.toHaveBeenCalled();
    expect(insertedLinkData).toBeNull();
  });

  it('folder contents query would find the linked item', async () => {
    const targetFolderId = 'folder-123';
    const itemId = 'item-456';
    const itemName = 'Test Note';

    // First, create the link
    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result: copyResult } = renderHook(() => useCopyVfsItem(), {
      wrapper
    });

    await act(async () => {
      await copyResult.current.copyItem(itemId, targetFolderId);
    });

    // Verify the link was created
    expect(insertedLinkData).toMatchObject({
      parentId: targetFolderId,
      childId: itemId
    });

    // Now simulate querying folder contents
    // The query joins vfsLinks with vfsRegistry where vfsLinks.parentId = folderId
    // and vfsLinks.childId = vfsRegistry.id
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: itemId,
        linkId: 'new-link-uuid',
        objectType: 'note',
        name: itemName,
        createdAt: new Date()
      }
    ]);

    const { result: contentsResult } = renderHook(
      () => useVfsFolderContents(targetFolderId),
      { wrapper }
    );

    await waitFor(() => {
      expect(contentsResult.current.hasFetched).toBe(true);
    });

    // The linked item should appear in folder contents
    expect(contentsResult.current.items).toHaveLength(1);
    expect(contentsResult.current.items[0]).toMatchObject({
      id: itemId,
      name: itemName,
      objectType: 'note'
    });
  });

  it('multiple items can be linked to the same folder', async () => {
    const targetFolderId = 'folder-123';
    const items = [
      { id: 'item-1', name: 'Item 1' },
      { id: 'item-2', name: 'Item 2' },
      { id: 'item-3', name: 'Item 3' }
    ];

    const insertedLinks: Record<string, unknown>[] = [];
    let linkCounter = 0;
    mockInsert.mockImplementation(() => ({
      values: vi.fn((data) => {
        insertedLinks.push({ ...data, id: `link-${++linkCounter}` });
        return Promise.resolve(undefined);
      })
    }));

    vi.mocked(crypto.randomUUID).mockImplementation(
      () =>
        `link-${linkCounter + 1}` as `${string}-${string}-${string}-${string}-${string}`
    );

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result } = renderHook(() => useCopyVfsItem(), { wrapper });

    // Link all items
    for (const item of items) {
      await act(async () => {
        await result.current.copyItem(item.id, targetFolderId);
      });
    }

    // All links should have the same parentId (target folder)
    expect(insertedLinks).toHaveLength(3);
    for (const link of insertedLinks) {
      expect(link['parentId']).toBe(targetFolderId);
    }

    // Each link should have a different childId
    const childIds = insertedLinks.map((l) => l['childId']);
    expect(childIds).toContain('item-1');
    expect(childIds).toContain('item-2');
    expect(childIds).toContain('item-3');
  });
});
