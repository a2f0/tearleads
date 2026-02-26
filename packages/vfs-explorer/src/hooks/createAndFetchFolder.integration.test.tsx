/**
 * Integration test for VFS folder creation and fetching.
 *
 * Tests the useCreateVfsFolder and useVfsFolders hooks with a real SQLite database,
 * verifying actual database state rather than mock calls.
 */

import { vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';
import type { VfsExplorerProviderProps } from '../context';
import { VfsExplorerProvider } from '../context';
import { useCreateVfsFolder } from './useCreateVfsFolder';
import { useVfsFolders } from './useVfsFolders';

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

function createTestWrapper(
  db: ReturnType<VfsExplorerProviderProps['getDatabase']>,
  overrides?: Partial<VfsExplorerProviderProps>
) {
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
      {...overrides}
    >
      {children}
    </VfsExplorerProvider>
  );
}

describe('VFS Folder Integration: Create and Fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a folder and verifies it appears in the folder list', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderName = 'My New Folder';
        const wrapper = createTestWrapper(
          db as ReturnType<VfsExplorerProviderProps['getDatabase']>
        );

        const { result: createResult } = renderHook(
          () => useCreateVfsFolder(),
          {
            wrapper
          }
        );

        let createdFolder: { id: string; name: string } | undefined;

        await act(async () => {
          createdFolder = await createResult.current.createFolder(folderName);
        });

        expect(createdFolder).toBeDefined();
        expect(createdFolder?.name).toBe(folderName);

        // Verify database state
        const registryRows = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, createdFolder?.id ?? ''));

        expect(registryRows).toHaveLength(1);
        expect(registryRows[0]?.objectType).toBe('folder');
        expect(registryRows[0]?.encryptedName).toBe(folderName);

        const linkRows = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, createdFolder?.id ?? ''));

        expect(linkRows).toHaveLength(1);
        expect(linkRows[0]?.parentId).toBe(VFS_ROOT_ID);

        // Verify folder appears in useVfsFolders
        const { result: foldersResult } = renderHook(() => useVfsFolders(), {
          wrapper
        });

        await waitFor(() => {
          expect(foldersResult.current.hasFetched).toBe(true);
        });

        expect(foldersResult.current.folders).toHaveLength(1);
        expect(foldersResult.current.folders[0]).toMatchObject({
          id: VFS_ROOT_ID,
          name: 'VFS Root',
          parentId: null
        });
        expect(foldersResult.current.folders[0]?.children).toHaveLength(1);
        expect(foldersResult.current.folders[0]?.children?.[0]).toMatchObject({
          id: createdFolder?.id,
          name: folderName,
          parentId: VFS_ROOT_ID
        });
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('creates a nested folder under an existing parent', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const wrapper = createTestWrapper(
          db as ReturnType<VfsExplorerProviderProps['getDatabase']>
        );

        const { result: createResult } = renderHook(
          () => useCreateVfsFolder(),
          {
            wrapper
          }
        );

        // Create parent folder first
        let parentFolder: { id: string; name: string } | undefined;
        await act(async () => {
          parentFolder =
            await createResult.current.createFolder('Parent Folder');
        });

        // Create child folder under parent
        let childFolder: { id: string; name: string } | undefined;
        await act(async () => {
          childFolder = await createResult.current.createFolder(
            'Child Folder',
            parentFolder?.id
          );
        });

        // Verify link points to parent folder
        const linkRows = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, childFolder?.id ?? ''));

        expect(linkRows).toHaveLength(1);
        expect(linkRows[0]?.parentId).toBe(parentFolder?.id);

        // Verify folder tree structure
        const { result: foldersResult } = renderHook(() => useVfsFolders(), {
          wrapper
        });

        await waitFor(() => {
          expect(foldersResult.current.hasFetched).toBe(true);
        });

        expect(foldersResult.current.folders).toHaveLength(1);
        const rootNode = foldersResult.current.folders[0];
        expect(rootNode?.id).toBe(VFS_ROOT_ID);
        expect(rootNode?.children).toHaveLength(1);
        const parentNode = rootNode?.children?.[0];
        expect(parentNode?.name).toBe('Parent Folder');
        expect(parentNode?.children).toHaveLength(1);
        expect(parentNode?.children?.[0]).toMatchObject({
          id: childFolder?.id,
          name: 'Child Folder',
          parentId: parentFolder?.id
        });
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('creates folder with encrypted session key when logged in', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderName = 'Encrypted Folder';
        const mockWrapSessionKey = vi.fn(async () => 'wrapped-key-123');
        const wrapper = createTestWrapper(
          db as ReturnType<VfsExplorerProviderProps['getDatabase']>,
          {
            vfsKeys: {
              generateSessionKey: vi.fn(() => new Uint8Array(32)),
              wrapSessionKey: mockWrapSessionKey
            },
            auth: {
              isLoggedIn: vi.fn(() => true),
              readStoredAuth: vi.fn(() => ({ user: { id: 'user-123' } }))
            }
          }
        );

        const { result: createResult } = renderHook(
          () => useCreateVfsFolder(),
          {
            wrapper
          }
        );

        let createdFolder: { id: string; name: string } | undefined;
        await act(async () => {
          createdFolder = await createResult.current.createFolder(folderName);
        });

        expect(mockWrapSessionKey).toHaveBeenCalled();

        // Verify database state includes encrypted session key and owner
        const registryRows = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, createdFolder?.id ?? ''));

        expect(registryRows).toHaveLength(1);
        expect(registryRows[0]).toMatchObject({
          objectType: 'folder',
          ownerId: 'user-123',
          encryptedSessionKey: 'wrapped-key-123'
        });
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('handles folder creation failure gracefully', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Create a mock that throws on transaction
        const mockDb = {
          ...db,
          transaction: vi
            .fn()
            .mockRejectedValue(new Error('Database write failed'))
        };
        const wrapper = createTestWrapper(
          mockDb as unknown as ReturnType<
            VfsExplorerProviderProps['getDatabase']
          >
        );

        const { result: createResult } = renderHook(
          () => useCreateVfsFolder(),
          {
            wrapper
          }
        );

        await act(async () => {
          try {
            await createResult.current.createFolder('Failed Folder');
          } catch {
            // Expected to throw
          }
        });

        expect(createResult.current.error).toBe('Database write failed');
        expect(createResult.current.isCreating).toBe(false);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('shows email folders linked to VFS_ROOT as children (#2274)', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Seed VFS root
        await db.insert(vfsRegistry).values({
          id: VFS_ROOT_ID,
          objectType: 'folder',
          ownerId: null,
          encryptedName: 'VFS Root',
          createdAt: new Date()
        });

        // Seed a regular user folder under VFS root
        const userFolderId = 'user-folder-1';
        await db.insert(vfsRegistry).values({
          id: userFolderId,
          objectType: 'folder',
          ownerId: null,
          encryptedName: 'My Documents',
          createdAt: new Date()
        });
        await db.insert(vfsLinks).values({
          id: 'link-1',
          parentId: VFS_ROOT_ID,
          childId: userFolderId,
          wrappedSessionKey: '',
          createdAt: new Date()
        });

        // Seed email system folders linked to VFS_ROOT (as initializeSystemFolders does)
        const emailFolders = ['Inbox', 'Sent', 'Drafts', 'Trash', 'Spam'];
        for (const name of emailFolders) {
          const emailId = `email-${name.toLowerCase()}`;
          await db.insert(vfsRegistry).values({
            id: emailId,
            objectType: 'folder',
            ownerId: null,
            encryptedName: name,
            icon: 'email-folder',
            createdAt: new Date()
          });
          await db.insert(vfsLinks).values({
            id: `link-email-${name.toLowerCase()}`,
            parentId: VFS_ROOT_ID,
            childId: emailId,
            wrappedSessionKey: '',
            createdAt: new Date()
          });
        }

        // Verify all folders exist in DB
        const allFolders = await db
          .select({ id: vfsRegistry.id })
          .from(vfsRegistry)
          .where(eq(vfsRegistry.objectType, 'folder'));
        expect(allFolders).toHaveLength(7); // root + user + 5 email

        const wrapper = createTestWrapper(
          db as ReturnType<VfsExplorerProviderProps['getDatabase']>
        );

        const { result: foldersResult } = renderHook(() => useVfsFolders(), {
          wrapper
        });

        await waitFor(() => {
          expect(foldersResult.current.hasFetched).toBe(true);
        });

        // VFS root should appear with all children (user folder + email folders)
        expect(foldersResult.current.folders).toHaveLength(1);
        expect(foldersResult.current.folders[0]?.id).toBe(VFS_ROOT_ID);
        expect(foldersResult.current.folders[0]?.children).toHaveLength(6);
        const childNames =
          foldersResult.current.folders[0]?.children?.map((c) => c.name) ?? [];
        expect(childNames).toContain('My Documents');
        for (const name of emailFolders) {
          expect(childNames).toContain(name);
        }
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('creates multiple folders and verifies they all appear', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const wrapper = createTestWrapper(
          db as ReturnType<VfsExplorerProviderProps['getDatabase']>
        );

        const { result: createResult } = renderHook(
          () => useCreateVfsFolder(),
          {
            wrapper
          }
        );

        // Create multiple folders
        await act(async () => {
          await createResult.current.createFolder('Folder A');
        });

        await act(async () => {
          await createResult.current.createFolder('Folder B');
        });

        await act(async () => {
          await createResult.current.createFolder('Folder C');
        });

        // Verify all appear in folder list
        const { result: foldersResult } = renderHook(() => useVfsFolders(), {
          wrapper
        });

        await waitFor(() => {
          expect(foldersResult.current.hasFetched).toBe(true);
        });

        expect(foldersResult.current.folders).toHaveLength(1);
        const folderNames =
          foldersResult.current.folders[0]?.children?.map((f) => f.name) ?? [];
        expect(folderNames).toContain('Folder A');
        expect(folderNames).toContain('Folder B');
        expect(folderNames).toContain('Folder C');
      },
      { migrations: vfsTestMigrations }
    );
  });
});
