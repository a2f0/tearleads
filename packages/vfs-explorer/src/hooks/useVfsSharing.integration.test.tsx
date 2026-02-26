import type { Database } from '@tearleads/db/sqlite';
import { withRealDatabase } from '@tearleads/db-test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VfsExplorerProviderProps,
  VfsShareApiFunctions
} from '../context';
import { VfsExplorerProvider } from '../context';
import {
  ALICE_EMAIL,
  ALICE_ID,
  BOB_EMAIL,
  BOB_ID,
  insertAcl,
  insertFolder,
  insertUser,
  seedBobAliceShare,
  vfsAclEnabledMigrations
} from '../test/vfsAclTestMigrations';
import { useVfsSharedByMe } from './useVfsSharedByMe';
import { useVfsSharedWithMe } from './useVfsSharedWithMe';
import { useVfsShares } from './useVfsShares';

const createMockUI = () =>
  ({
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
  }) as unknown as VfsExplorerProviderProps['ui'];

function createRealDbVfsWrapper(
  db: Database,
  userId: string,
  vfsShareApi?: VfsShareApiFunctions
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <VfsExplorerProvider
        databaseState={{
          isUnlocked: true,
          isLoading: false,
          currentInstanceId: 'test-instance'
        }}
        getDatabase={
          (() => db) as VfsExplorerProviderProps['getDatabase']
        }
        ui={createMockUI()}
        vfsKeys={{
          generateSessionKey: vi.fn(() => new Uint8Array(32)),
          wrapSessionKey: vi.fn(async () => 'wrapped-key')
        }}
        auth={{
          isLoggedIn: vi.fn(() => true),
          readStoredAuth: vi.fn(() => ({ user: { id: userId } }))
        }}
        featureFlags={{
          getFeatureFlagValue: vi.fn(() => false)
        }}
        vfsApi={{
          register: vi.fn(async () => {})
        }}
        vfsShareApi={vfsShareApi}
      >
        {children}
      </VfsExplorerProvider>
    );
  };
}

describe('useVfsSharing integration (real database)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useVfsSharedByMe returns Bob shared items from real DB', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        await seedBobAliceShare(adapter, 'write');

        const wrapper = createRealDbVfsWrapper(db, BOB_ID);
        const { result } = renderHook(() => useVfsSharedByMe(), { wrapper });

        await waitFor(() => {
          expect(result.current.hasFetched).toBe(true);
        });

        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]?.name).toBe('Shared Project');
        expect(result.current.items[0]?.shareId).toBe('bob-to-alice');
        expect(result.current.items[0]?.targetId).toBe(ALICE_ID);
        expect(result.current.items[0]?.permissionLevel).toBe('edit');
        expect(result.current.items[0]?.objectType).toBe('folder');
        expect(result.current.error).toBeNull();
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('useVfsSharedWithMe returns Alice received items with sharedByEmail', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        await seedBobAliceShare(adapter, 'write');

        const wrapper = createRealDbVfsWrapper(db, ALICE_ID);
        const { result } = renderHook(() => useVfsSharedWithMe(), { wrapper });

        await waitFor(() => {
          expect(result.current.hasFetched).toBe(true);
        });

        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]?.name).toBe('Shared Project');
        expect(result.current.items[0]?.shareId).toBe('bob-to-alice');
        expect(result.current.items[0]?.sharedById).toBe(BOB_ID);
        expect(result.current.items[0]?.sharedByEmail).toBe(BOB_EMAIL);
        expect(result.current.items[0]?.permissionLevel).toBe('edit');
        expect(result.current.error).toBeNull();
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('both hooks return empty when no shares exist', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        await insertUser(adapter, BOB_ID, BOB_EMAIL);

        const bobWrapper = createRealDbVfsWrapper(db, BOB_ID);
        const { result: byMe } = renderHook(() => useVfsSharedByMe(), {
          wrapper: bobWrapper
        });

        await waitFor(() => {
          expect(byMe.current.hasFetched).toBe(true);
        });

        expect(byMe.current.items).toHaveLength(0);
        expect(byMe.current.error).toBeNull();

        const aliceWrapper = createRealDbVfsWrapper(db, ALICE_ID);
        const { result: withMe } = renderHook(() => useVfsSharedWithMe(), {
          wrapper: aliceWrapper
        });

        await waitFor(() => {
          expect(withMe.current.hasFetched).toBe(true);
        });

        expect(withMe.current.items).toHaveLength(0);
        expect(withMe.current.error).toBeNull();
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('revoked shares not returned by either hook', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = Date.now();
        const folderId = crypto.randomUUID();

        await insertUser(adapter, BOB_ID, BOB_EMAIL);
        await insertUser(adapter, ALICE_ID, ALICE_EMAIL);
        await insertFolder(adapter, folderId, 'Revoked Folder', BOB_ID, now);
        await insertAcl(adapter, {
          id: 'share:revoked',
          itemId: folderId,
          principalType: 'user',
          principalId: ALICE_ID,
          accessLevel: 'read',
          grantedBy: BOB_ID,
          createdAt: now,
          revokedAt: now + 1000
        });

        const bobWrapper = createRealDbVfsWrapper(db, BOB_ID);
        const { result: byMe } = renderHook(() => useVfsSharedByMe(), {
          wrapper: bobWrapper
        });

        await waitFor(() => {
          expect(byMe.current.hasFetched).toBe(true);
        });
        expect(byMe.current.items).toHaveLength(0);

        const aliceWrapper = createRealDbVfsWrapper(db, ALICE_ID);
        const { result: withMe } = renderHook(() => useVfsSharedWithMe(), {
          wrapper: aliceWrapper
        });

        await waitFor(() => {
          expect(withMe.current.hasFetched).toBe(true);
        });
        expect(withMe.current.items).toHaveLength(0);
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('date fields are proper Date objects with correct permission mapping', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        await seedBobAliceShare(adapter, 'write');

        const wrapper = createRealDbVfsWrapper(db, BOB_ID);
        const { result } = renderHook(() => useVfsSharedByMe(), { wrapper });

        await waitFor(() => {
          expect(result.current.hasFetched).toBe(true);
        });

        const item = result.current.items[0];
        expect(item?.createdAt).toBeInstanceOf(Date);
        expect(item?.sharedAt).toBeInstanceOf(Date);
        expect(item?.expiresAt).toBeNull();
        expect(item?.permissionLevel).toBe('edit');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('useVfsShares.createShare calls API with correct params', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const itemId = crypto.randomUUID();
        const mockShareApi: VfsShareApiFunctions = {
          getShares: vi.fn(async () => ({ shares: [], orgShares: [] })),
          createShare: vi.fn(async (req) => ({
            id: 'new-share-id',
            itemId: req.itemId,
            shareType: req.shareType,
            targetId: req.targetId,
            targetName: 'Alice',
            permissionLevel: req.permissionLevel,
            createdBy: BOB_ID,
            createdByEmail: BOB_EMAIL,
            createdAt: new Date().toISOString(),
            expiresAt: null
          })),
          updateShare: vi.fn(async () => ({
            id: 'share-id',
            itemId,
            shareType: 'user' as const,
            targetId: ALICE_ID,
            targetName: 'Alice',
            permissionLevel: 'edit' as const,
            createdBy: BOB_ID,
            createdByEmail: BOB_EMAIL,
            createdAt: new Date().toISOString(),
            expiresAt: null
          })),
          deleteShare: vi.fn(async () => ({ deleted: true })),
          createOrgShare: vi.fn(async () => ({
            id: 'org-share-id',
            itemId,
            sourceOrgId: 'org-1',
            sourceOrgName: 'Source Org',
            targetOrgId: 'org-2',
            targetOrgName: 'Org',
            permissionLevel: 'view' as const,
            createdBy: BOB_ID,
            createdByEmail: BOB_EMAIL,
            createdAt: new Date().toISOString(),
            expiresAt: null
          })),
          deleteOrgShare: vi.fn(async () => ({ deleted: true })),
          searchTargets: vi.fn(async () => ({ results: [] }))
        };

        const wrapper = createRealDbVfsWrapper(db, BOB_ID, mockShareApi);
        const { result } = renderHook(() => useVfsShares(itemId), { wrapper });

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        let createdShare: unknown;
        await act(async () => {
          createdShare = await result.current.createShare({
            shareType: 'user',
            targetId: ALICE_ID,
            permissionLevel: 'edit'
          });
        });

        expect(mockShareApi.createShare).toHaveBeenCalledWith({
          itemId,
          shareType: 'user',
          targetId: ALICE_ID,
          permissionLevel: 'edit'
        });
        expect(createdShare).toMatchObject({
          id: 'new-share-id',
          targetId: ALICE_ID
        });

        expect(result.current.shares).toHaveLength(1);
        expect(result.current.shares[0]?.id).toBe('new-share-id');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });
});
