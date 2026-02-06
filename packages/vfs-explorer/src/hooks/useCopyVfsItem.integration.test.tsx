/**
 * Integration test for useCopyVfsItem hook with real SQLite database.
 *
 * This test demonstrates how to use @rapid/db-test-utils to test hooks
 * that mutate the database, asserting on actual database state rather than mocks.
 */

import { vfsLinks } from '@rapid/db/sqlite';
import type { DatabaseAdapter } from '@rapid/db-test-utils';
import {
  seedFolder,
  seedVfsItem,
  withRealDatabase
} from '@rapid/db-test-utils';
import { act, renderHook } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsExplorerProviderProps } from '../context';
import { VfsExplorerProvider } from '../context';
import { useCopyVfsItem } from './useCopyVfsItem';

// VFS table migrations for test database
const vfsMigrations = [
  {
    version: 1,
    up: async (adapter: DatabaseAdapter) => {
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_registry (
          id TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          owner_id TEXT,
          encrypted_session_key TEXT,
          public_hierarchical_key TEXT,
          encrypted_private_hierarchical_key TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_folders (
          id TEXT PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
          encrypted_name TEXT,
          icon TEXT,
          view_mode TEXT,
          default_sort TEXT,
          sort_direction TEXT
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_links (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          child_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          wrapped_session_key TEXT NOT NULL,
          wrapped_hierarchical_key TEXT,
          visible_children TEXT,
          position INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];

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

describe('useCopyVfsItem integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a link when copying an item to a folder', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange: seed source folder and target folder
        const sourceFolderId = await seedFolder(db, { name: 'Source Folder' });
        const targetFolderId = await seedFolder(db, { name: 'Target Folder' });

        // Create an item in the source folder
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

        const { result } = renderHook(() => useCopyVfsItem(), { wrapper });

        // Act: copy the item to target folder
        await act(async () => {
          await result.current.copyItem(itemId, targetFolderId);
        });

        // Assert: verify link was created in the actual database
        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, itemId));

        // Should have 2 links: original (source) and new (target)
        expect(links).toHaveLength(2);

        const parentIds = links.map((link) => link.parentId);
        expect(parentIds).toContain(sourceFolderId);
        expect(parentIds).toContain(targetFolderId);

        // Verify the new link has correct properties
        const targetLink = links.find(
          (link) => link.parentId === targetFolderId
        );
        expect(targetLink).toBeDefined();
        expect(targetLink?.childId).toBe(itemId);
      },
      { migrations: vfsMigrations }
    );
  });

  it('does not create duplicate link if item already exists in folder', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange: seed folder and item already linked to it
        const folderId = await seedFolder(db, { name: 'Target Folder' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: folderId
        });

        // Create wrapper
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

        // Act: try to copy item to folder it's already in
        await act(async () => {
          await result.current.copyItem(itemId, folderId);
        });

        // Assert: should still only have one link
        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, itemId));

        expect(links).toHaveLength(1);
        expect(links[0]?.parentId).toBe(folderId);
      },
      { migrations: vfsMigrations }
    );
  });

  it('wraps session key when user is logged in', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange
        const folderId = await seedFolder(db, { name: 'Target Folder' });
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });

        const mockWrapSessionKey = vi.fn(async () => 'wrapped-session-key-123');

        // Create wrapper with logged-in user
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
              wrapSessionKey: mockWrapSessionKey
            }}
            auth={{
              isLoggedIn: vi.fn(() => true),
              readStoredAuth: vi.fn(() => ({ user: { id: 'user-123' } }))
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

        // Assert
        expect(mockWrapSessionKey).toHaveBeenCalled();

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, itemId));

        expect(links).toHaveLength(1);
        expect(links[0]?.wrappedSessionKey).toBe('wrapped-session-key-123');
      },
      { migrations: vfsMigrations }
    );
  });

  it('sets error state on failure', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Arrange: create wrapper but don't seed any data
        // The insert will fail due to foreign key constraint
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

        // Act: try to copy with non-existent IDs
        await act(async () => {
          try {
            await result.current.copyItem(
              'nonexistent-item',
              'nonexistent-folder'
            );
          } catch {
            // Expected to throw
          }
        });

        // Assert: error state should be set
        expect(result.current.error).not.toBeNull();
        expect(result.current.isCopying).toBe(false);
      },
      { migrations: vfsMigrations }
    );
  });
});
