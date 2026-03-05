import { vfsRegistry } from '@tearleads/db/sqlite';
import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';
import type { VfsExplorerProviderProps } from '../context';
import { VfsExplorerProvider } from '../context';
import { useEnsureVfsRoot } from './useEnsureVfsRoot';

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

function createWrapper(
  db: ReturnType<VfsExplorerProviderProps['getDatabase']>
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
    >
      {children}
    </VfsExplorerProvider>
  );
}

describe('useEnsureVfsRoot integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates VFS root once and keeps it idempotent', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const wrapper = createWrapper(
          db as ReturnType<VfsExplorerProviderProps['getDatabase']>
        );
        const { result } = renderHook(() => useEnsureVfsRoot(), { wrapper });

        await waitFor(() => {
          expect(result.current.isReady).toBe(true);
        });

        const initialRows = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, VFS_ROOT_ID));
        expect(initialRows).toHaveLength(1);

        await act(async () => {
          await result.current.ensureRoot();
        });

        const rowsAfterSecondEnsure = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, VFS_ROOT_ID));
        expect(rowsAfterSecondEnsure).toHaveLength(1);
        expect(result.current.error).toBeNull();
      },
      { migrations: vfsTestMigrations }
    );
  });
});
