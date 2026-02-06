/**
 * Integration test for the link creation and folder contents query flow.
 *
 * This tests that when items are linked to folders via useCopyVfsItem,
 * the useVfsFolderContents hook correctly retrieves them.
 */

import { vfsLinks } from '@rapid/db/sqlite';
import {
  seedFolder,
  seedVfsItem,
  vfsTestMigrations,
  withRealDatabase
} from '@rapid/db-test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsExplorerProviderProps } from '../context';
import { VfsExplorerProvider } from '../context';
import { queryFolderContents } from '../lib/vfsQuery';
import { useCopyVfsItem } from './useCopyVfsItem';
import { useVfsFolderContents } from './useVfsFolderContents';

// Mock UI components (these aren't used in hook tests)
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

describe('VFS Link Integration: Link Item and Fetch Folder Contents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a link with correct parentId and childId', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange
        const folderId = await seedFolder(db, { name: 'Target Folder' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });

        // Create wrapper with real database
        const wrapper = ({ children }: { children: ReactNode }) => (
          <VfsExplorerProvider
            databaseState={{
              isUnlocked: true,
              isLoading: false,
              currentInstanceId: 'test-instance'
            }}
            getDatabase={() =>
              db as ReturnType<VfsExplorerProviderProps['getDatabase']>
            }
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

        const { result } = renderHook(() => useCopyVfsItem(), { wrapper });

        // Act
        await act(async () => {
          await result.current.copyItem(itemId, folderId);
        });

        // Assert - verify actual database state
        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, itemId));

        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
          parentId: folderId,
          childId: itemId
        });
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryFolderContents returns linked items', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange - create folder and items, link them
        const folderId = await seedFolder(db, { name: 'Parent Folder' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: folderId
        });

        // Act - query folder contents directly
        const contents = await queryFolderContents(db, folderId, {
          column: null,
          direction: null
        });

        // Assert - item should appear in folder contents
        expect(contents).toHaveLength(1);
        expect(contents[0]).toMatchObject({
          id: itemId,
          objectType: 'file'
        });
        // linkId should be set
        expect(contents[0]?.linkId).toBeDefined();
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('useVfsFolderContents hook returns linked items', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange
        const folderId = await seedFolder(db, { name: 'Parent Folder' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: folderId
        });

        // Create wrapper with real database
        const wrapper = ({ children }: { children: ReactNode }) => (
          <VfsExplorerProvider
            databaseState={{
              isUnlocked: true,
              isLoading: false,
              currentInstanceId: 'test-instance'
            }}
            getDatabase={() =>
              db as ReturnType<VfsExplorerProviderProps['getDatabase']>
            }
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

        // Act
        const { result } = renderHook(() => useVfsFolderContents(folderId), {
          wrapper
        });

        // Wait for fetch to complete
        await waitFor(() => {
          expect(result.current.hasFetched).toBe(true);
        });

        // Assert
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]).toMatchObject({
          id: itemId,
          objectType: 'file'
        });
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('multiple items linked to same folder all appear in contents', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange
        const folderId = await seedFolder(db, { name: 'Parent Folder' });

        // Create multiple items linked to the folder
        const item1Id = await seedVfsItem(db, {
          objectType: 'file',
          parentId: folderId
        });
        const item2Id = await seedVfsItem(db, {
          objectType: 'note',
          parentId: folderId
        });
        const item3Id = await seedVfsItem(db, {
          objectType: 'contact',
          parentId: folderId
        });

        // Act - query folder contents
        const contents = await queryFolderContents(db, folderId, {
          column: null,
          direction: null
        });

        // Assert - all items should appear
        expect(contents).toHaveLength(3);
        const itemIds = contents.map((c) => c.id);
        expect(itemIds).toContain(item1Id);
        expect(itemIds).toContain(item2Id);
        expect(itemIds).toContain(item3Id);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('copied item appears in target folder contents', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange
        const sourceFolderId = await seedFolder(db, { name: 'Source' });
        const targetFolderId = await seedFolder(db, { name: 'Target' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: sourceFolderId
        });

        // Create wrapper with real database
        const wrapper = ({ children }: { children: ReactNode }) => (
          <VfsExplorerProvider
            databaseState={{
              isUnlocked: true,
              isLoading: false,
              currentInstanceId: 'test-instance'
            }}
            getDatabase={() =>
              db as ReturnType<VfsExplorerProviderProps['getDatabase']>
            }
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

        const { result: copyResult } = renderHook(() => useCopyVfsItem(), {
          wrapper
        });

        // Act - copy item to target folder
        await act(async () => {
          await copyResult.current.copyItem(itemId, targetFolderId);
        });

        // Assert - item should appear in both folders
        const sourceContents = await queryFolderContents(db, sourceFolderId, {
          column: null,
          direction: null
        });
        const targetContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });

        expect(sourceContents).toHaveLength(1);
        expect(sourceContents[0]?.id).toBe(itemId);

        expect(targetContents).toHaveLength(1);
        expect(targetContents[0]?.id).toBe(itemId);
      },
      { migrations: vfsTestMigrations }
    );
  });
});
