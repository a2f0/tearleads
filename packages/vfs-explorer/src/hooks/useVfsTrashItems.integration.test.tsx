import {
  seedVfsItem,
  vfsTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VfsExplorerProviderProps } from '../context';
import { VfsExplorerProvider } from '../context';
import { useVfsTrashItems } from './useVfsTrashItems';

function createMockUI(): VfsExplorerProviderProps['ui'] {
  return {
    Button: ({ children }) => <button type="button">{children}</button>,
    Input: (props) => <input {...props} />,
    DropdownMenu: ({ children }) => <div>{children}</div>,
    DropdownMenuItem: ({ children }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    WindowOptionsMenuItem: () => <div>Options</div>,
    AboutMenuItem: () => <div>About</div>,
    FloatingWindow: ({ children }) => <div>{children}</div>,
    ContextMenu: ({ children }) => <div>{children}</div>,
    ContextMenuItem: ({ children, onClick }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    ContextMenuSeparator: () => <hr />
  };
}

describe('useVfsTrashItems integration (real database)', () => {
  it('returns only items marked deleted', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const deletedId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });
        const activeId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });

        await adapter.execute(
          `INSERT OR REPLACE INTO vfs_item_state (item_id, updated_at, deleted_at) VALUES ('${deletedId}', 1, 2)`
        );
        await adapter.execute(
          `INSERT OR REPLACE INTO vfs_item_state (item_id, updated_at, deleted_at) VALUES ('${activeId}', 1, NULL)`
        );

        const wrapper = ({ children }: { children: ReactNode }) => (
          <VfsExplorerProvider
            databaseState={{
              isUnlocked: true,
              isLoading: false,
              currentInstanceId: 'test-instance'
            }}
            getDatabase={() => db}
            ui={createMockUI()}
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

        const { result } = renderHook(() => useVfsTrashItems(), { wrapper });

        await waitFor(() => {
          expect(result.current.hasFetched).toBe(true);
        });

        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]?.id).toBe(deletedId);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('refetch picks up newly deleted items', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const firstDeletedId = await seedVfsItem(db, {
          objectType: 'note',
          createLink: false
        });
        await adapter.execute(
          `INSERT OR REPLACE INTO vfs_item_state (item_id, updated_at, deleted_at) VALUES ('${firstDeletedId}', 1, 2)`
        );

        const wrapper = ({ children }: { children: ReactNode }) => (
          <VfsExplorerProvider
            databaseState={{
              isUnlocked: true,
              isLoading: false,
              currentInstanceId: 'test-instance'
            }}
            getDatabase={() => db}
            ui={createMockUI()}
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

        const { result } = renderHook(() => useVfsTrashItems(), { wrapper });

        await waitFor(() => {
          expect(result.current.items).toHaveLength(1);
        });

        const secondDeletedId = await seedVfsItem(db, {
          objectType: 'contact',
          createLink: false
        });
        await adapter.execute(
          `INSERT OR REPLACE INTO vfs_item_state (item_id, updated_at, deleted_at) VALUES ('${secondDeletedId}', 1, 2)`
        );

        await act(async () => {
          await result.current.refetch();
        });

        const ids = result.current.items.map((item) => item.id);
        expect(ids).toContain(firstDeletedId);
        expect(ids).toContain(secondDeletedId);
      },
      { migrations: vfsTestMigrations }
    );
  });
});
