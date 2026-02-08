/**
 * Integration tests for useMoveVfsItem with a real SQLite database.
 *
 * These tests cover the drag-and-drop move behavior that was skipped in
 * Playwright due to synthetic pointer event limitations with dnd-kit.
 */

import type { Database } from '@rapid/db/sqlite';
import { vfsLinks } from '@rapid/db/sqlite';
import {
  seedFolder,
  seedVfsItem,
  vfsTestMigrations,
  withRealDatabase
} from '@rapid/db-test-utils';
import { act, renderHook } from '@testing-library/react';
import { and, eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsExplorerProviderProps } from '../context';
import { VfsExplorerProvider } from '../context';
import { queryFolderContents } from '../lib/vfsQuery';
import { useMoveVfsItem } from './useMoveVfsItem';

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

        const targetItemOneLink = await db
          .select()
          .from(vfsLinks)
          .where(
            and(
              eq(vfsLinks.childId, itemOneId),
              eq(vfsLinks.parentId, targetFolderId)
            )
          );
        const targetItemTwoLink = await db
          .select()
          .from(vfsLinks)
          .where(
            and(
              eq(vfsLinks.childId, itemTwoId),
              eq(vfsLinks.parentId, targetFolderId)
            )
          );

        expect(targetItemOneLink).toHaveLength(1);
        expect(targetItemTwoLink).toHaveLength(1);

        const targetContents = await queryFolderContents(db, targetFolderId, {
          column: null,
          direction: null
        });
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
        const targetFolderId = await seedFolder(db, { name: 'Link Test Folder' });
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
});
