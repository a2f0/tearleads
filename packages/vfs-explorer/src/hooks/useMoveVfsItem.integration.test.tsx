/**
 * Integration tests for useMoveVfsItem with a real SQLite database.
 *
 * These tests cover the drag-and-drop move behavior that was skipped in
 * Playwright due to synthetic pointer event limitations with dnd-kit.
 */

import type { Database } from '@tearleads/db/sqlite';
import { vfsLinks } from '@tearleads/db/sqlite';
import {
  seedFolder,
  seedVfsItem,
  vfsTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsExplorerProviderProps } from '../context';
import { VfsExplorerProvider } from '../context';
import { queryFolderContents } from '../lib/vfsQuery';
import { useMoveVfsItem } from './useMoveVfsItem';
import { useVfsFolders } from './useVfsFolders';

const createMockUI = () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  WindowOptionsMenuItem: () => <div>Options</div>,
  AboutMenuItem: () => <div>About</div>,
  FloatingWindow: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
});

function createWrapper(db: Database) {
  return ({ children }: { children: ReactNode }) => (
    <VfsExplorerProvider
      databaseState={{
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'test-instance'
      }}
      getDatabase={() => db}
      ui={createMockUI() as unknown as VfsExplorerProviderProps['ui']}
      vfsKeys={{
        generateSessionKey: vi.fn(() => new Uint8Array(32)),
        wrapSessionKey: vi.fn(async () => 'wrapped-key')
      }}
      auth={{
        isLoggedIn: vi.fn(() => false),
        readStoredAuth: vi.fn(() => ({ user: null }))
      }}
      featureFlags={{
        getFeatureFlagValue: vi.fn(() => false)
      }}
      vfsApi={{
        register: vi.fn(async () => {})
      }}
    >
      {children}
    </VfsExplorerProvider>
  );
}

describe('useMoveVfsItem integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves one item into a target folder', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const sourceFolderId = await seedFolder(db, { name: 'Source Folder' });
        const targetFolderId = await seedFolder(db, { name: 'Target Folder' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: sourceFolderId
        });

        const { result } = renderHook(() => useMoveVfsItem(), {
          wrapper: createWrapper(db)
        });

        await act(async () => {
          await result.current.moveItem(itemId, targetFolderId);
        });

        const allLinks = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, itemId));
        expect(allLinks).toHaveLength(1);
        expect(allLinks[0]?.parentId).toBe(targetFolderId);

        const sourceContents = await queryFolderContents(db, sourceFolderId, {
          column: null,
          direction: null
        });
        const targetContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });

        expect(sourceContents).toHaveLength(0);
        expect(targetContents).toHaveLength(1);
        expect(targetContents[0]?.id).toBe(itemId);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('moves multiple items into a target folder', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const sourceFolderId = await seedFolder(db, { name: 'Source Folder' });
        const targetFolderId = await seedFolder(db, { name: 'Target Folder' });
        const itemOneId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: sourceFolderId
        });
        const itemTwoId = await seedVfsItem(db, {
          objectType: 'photo',
          parentId: sourceFolderId
        });

        const { result } = renderHook(() => useMoveVfsItem(), {
          wrapper: createWrapper(db)
        });

        await act(async () => {
          await result.current.moveItem(itemOneId, targetFolderId);
          await result.current.moveItem(itemTwoId, targetFolderId);
        });

        const sourceContents = await queryFolderContents(db, sourceFolderId, {
          column: null,
          direction: null
        });
        expect(sourceContents).toHaveLength(0);

        const targetContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });
        expect(targetContents).toHaveLength(2);
        const targetIds = targetContents.map((item) => item.id);
        expect(targetIds).toContain(itemOneId);
        expect(targetIds).toContain(itemTwoId);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('shows folder contents after creating a move link', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const sourceFolderId = await seedFolder(db, { name: 'Unfiled Source' });
        const targetFolderId = await seedFolder(db, {
          name: 'Link Test Folder'
        });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: sourceFolderId
        });

        const emptyContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });
        expect(emptyContents).toHaveLength(0);

        const { result } = renderHook(() => useMoveVfsItem(), {
          wrapper: createWrapper(db)
        });

        await act(async () => {
          await result.current.moveItem(itemId, targetFolderId);
        });

        const sourceContents = await queryFolderContents(db, sourceFolderId, {
          column: null,
          direction: null
        });
        expect(sourceContents).toHaveLength(0);

        const targetContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });
        expect(targetContents).toHaveLength(1);
        expect(targetContents[0]?.id).toBe(itemId);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('links three unfiled items into target folder for batch drag', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const targetFolderId = await seedFolder(db, { name: 'Target Folder' });
        const unfiledItemOneId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });
        const unfiledItemTwoId = await seedVfsItem(db, {
          objectType: 'photo',
          createLink: false
        });
        const unfiledItemThreeId = await seedVfsItem(db, {
          objectType: 'note',
          createLink: false
        });

        const { result } = renderHook(() => useMoveVfsItem(), {
          wrapper: createWrapper(db)
        });

        await act(async () => {
          await result.current.moveItem(unfiledItemOneId, targetFolderId);
          await result.current.moveItem(unfiledItemTwoId, targetFolderId);
          await result.current.moveItem(unfiledItemThreeId, targetFolderId);
        });

        const targetContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });
        expect(targetContents).toHaveLength(3);
        const targetIds = targetContents.map((item) => item.id);
        expect(targetIds).toContain(unfiledItemOneId);
        expect(targetIds).toContain(unfiledItemTwoId);
        expect(targetIds).toContain(unfiledItemThreeId);

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, targetFolderId));
        expect(links).toHaveLength(3);
        expect(links.every((link) => link.parentId === targetFolderId)).toBe(
          true
        );
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('updates folder childCount after moving an unfiled item and refetching', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const targetFolderId = await seedFolder(db, {
          name: 'Target Folder'
        });
        // Create an unfiled item (no parent link)
        const unfiledItemId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });

        const wrapper = createWrapper(db);

        // Render useVfsFolders to get initial childCount
        const foldersHook = renderHook(() => useVfsFolders(), { wrapper });

        await waitFor(() => {
          expect(foldersHook.result.current.hasFetched).toBe(true);
        });

        // Find the target folder and verify initial childCount is 0
        const findFolder = (id: string) => {
          const searchFolders = (
            folders: typeof foldersHook.result.current.folders
          ): (typeof folders)[0] | undefined => {
            for (const folder of folders) {
              if (folder.id === id) return folder;
              if (folder.children) {
                const found = searchFolders(folder.children);
                if (found) return found;
              }
            }
            return undefined;
          };
          return searchFolders(foldersHook.result.current.folders);
        };

        const initialFolder = findFolder(targetFolderId);
        expect(initialFolder?.childCount).toBe(0);

        // Move the unfiled item to the target folder
        const moveHook = renderHook(() => useMoveVfsItem(), { wrapper });

        await act(async () => {
          await moveHook.result.current.moveItem(unfiledItemId, targetFolderId);
        });

        // Verify the move happened in the database
        const targetContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });
        expect(targetContents).toHaveLength(1);
        expect(targetContents[0]?.id).toBe(unfiledItemId);

        // Refetch folders to update childCount
        await act(async () => {
          await foldersHook.result.current.refetch();
        });

        // Verify childCount is now 1 after refetch
        const updatedFolder = findFolder(targetFolderId);
        expect(updatedFolder?.childCount).toBe(1);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('updates both source and target folder childCounts after move and refetch', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const sourceFolderId = await seedFolder(db, { name: 'Source Folder' });
        const targetFolderId = await seedFolder(db, { name: 'Target Folder' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: sourceFolderId
        });

        const wrapper = createWrapper(db);

        // Render useVfsFolders to get initial childCounts
        const foldersHook = renderHook(() => useVfsFolders(), { wrapper });

        await waitFor(() => {
          expect(foldersHook.result.current.hasFetched).toBe(true);
        });

        const findFolder = (id: string) => {
          const searchFolders = (
            folders: typeof foldersHook.result.current.folders
          ): (typeof folders)[0] | undefined => {
            for (const folder of folders) {
              if (folder.id === id) return folder;
              if (folder.children) {
                const found = searchFolders(folder.children);
                if (found) return found;
              }
            }
            return undefined;
          };
          return searchFolders(foldersHook.result.current.folders);
        };

        // Verify initial counts
        expect(findFolder(sourceFolderId)?.childCount).toBe(1);
        expect(findFolder(targetFolderId)?.childCount).toBe(0);

        // Move the item from source to target
        const moveHook = renderHook(() => useMoveVfsItem(), { wrapper });

        await act(async () => {
          await moveHook.result.current.moveItem(itemId, targetFolderId);
        });

        // Refetch folders
        await act(async () => {
          await foldersHook.result.current.refetch();
        });

        // Verify updated counts
        expect(findFolder(sourceFolderId)?.childCount).toBe(0);
        expect(findFolder(targetFolderId)?.childCount).toBe(1);
      },
      { migrations: vfsTestMigrations }
    );
  });
});
