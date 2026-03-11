import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { ClientVfsExplorerProvider } from './ClientVfsExplorerProvider';

const mockRotateItemKeyEpochAndPersist = vi.fn();
const mockUseVfsKeyManager = vi.fn();
const mockUseVfsOrchestratorInstance = vi.fn();
const mockHydrateLocalReadModelFromRemoteFeeds = vi.fn();

const mockDeleteShare = vi.fn();
const mockDeleteOrgShare = vi.fn();
const mockRekeyItem = vi.fn();

let capturedProviderProps: Record<string, unknown> | null = null;

vi.mock('@tearleads/api-client/clientEntry', () => ({
  rotateItemKeyEpochAndPersist: (...args: unknown[]) =>
    mockRotateItemKeyEpochAndPersist(...args)
}));

vi.mock('@tearleads/vfs-explorer', () => ({
  VfsExplorerAboutMenuItem: () => <div>VfsExplorerAboutMenuItem</div>,
  VfsExplorerProvider: ({ children, ...props }: Record<string, unknown>) => {
    capturedProviderProps = props;
    return <>{children}</>;
  }
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: vi.fn(() => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'instance-1'
  }))
}));

vi.mock('@/db/hooks/useHostRuntimeDatabaseState', () => ({
  useHostRuntimeDatabaseState: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'instance-1'
  })
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({}))
}));

vi.mock('@/hooks/vfs/useVfsKeys', () => ({
  generateSessionKey: vi.fn(() => new Uint8Array([1, 2, 3])),
  wrapSessionKey: vi.fn(async () => 'wrapped')
}));

vi.mock('@/lib/authStorage', () => ({
  isLoggedIn: vi.fn(() => true),
  readStoredAuth: vi.fn(() => ({ user: { id: 'user-1' } }))
}));

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ isAuthenticated: true })
}));

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlagValue: vi.fn(() => false)
}));

vi.mock('@/lib/vfsReadModelHydration', () => ({
  hydrateLocalReadModelFromRemoteFeeds: () =>
    mockHydrateLocalReadModelFromRemoteFeeds()
}));

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      register: vi.fn(),
      getShares: vi.fn(),
      createShare: vi.fn(),
      updateShare: vi.fn(),
      deleteShare: (...args: unknown[]) => mockDeleteShare(...args),
      createOrgShare: vi.fn(),
      deleteOrgShare: (...args: unknown[]) => mockDeleteOrgShare(...args),
      searchShareTargets: vi.fn(),
      rekeyItem: (...args: unknown[]) => mockRekeyItem(...args)
    }
  }
}));

vi.mock('./VfsOrchestratorContext', () => ({
  useVfsKeyManager: () => mockUseVfsKeyManager(),
  useVfsOrchestratorInstance: () => mockUseVfsOrchestratorInstance()
}));

describe('ClientVfsExplorerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProviderProps = null;
    mockUseVfsKeyManager.mockReturnValue({
      rotateItemKeyEpoch: vi.fn()
    });
    mockUseVfsOrchestratorInstance.mockReturnValue({
      syncCrdt: vi.fn().mockResolvedValue(undefined)
    });
    mockDeleteShare.mockResolvedValue({ deleted: true });
    mockDeleteOrgShare.mockResolvedValue({ deleted: true });
    mockRotateItemKeyEpochAndPersist.mockResolvedValue({
      newEpoch: 2,
      wraps: []
    });
    mockHydrateLocalReadModelFromRemoteFeeds.mockResolvedValue(undefined);
  });

  it('rekeys item after user share revoke', async () => {
    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const vfsShareApi = capturedProviderProps?.vfsShareApi as {
      deleteShare: (
        shareId: string,
        itemId?: string
      ) => Promise<{
        deleted: boolean;
      }>;
    };

    await vfsShareApi.deleteShare('share-1', 'item-1');

    expect(mockDeleteShare).toHaveBeenCalledWith('share-1');
    expect(mockRotateItemKeyEpochAndPersist).toHaveBeenCalledTimes(1);
    expect(mockRotateItemKeyEpochAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        reason: 'unshare',
        keyManager: expect.any(Object)
      })
    );
  });

  it('rekeys item after org share revoke', async () => {
    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const vfsShareApi = capturedProviderProps?.vfsShareApi as {
      deleteOrgShare: (
        shareId: string,
        itemId?: string
      ) => Promise<{
        deleted: boolean;
      }>;
    };

    await vfsShareApi.deleteOrgShare('org-share-1', 'item-1');

    expect(mockDeleteOrgShare).toHaveBeenCalledWith('org-share-1');
    expect(mockRotateItemKeyEpochAndPersist).toHaveBeenCalledTimes(1);
    expect(mockRotateItemKeyEpochAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        reason: 'unshare',
        keyManager: expect.any(Object)
      })
    );
  });

  it('skips rekey when itemId is unavailable', async () => {
    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const vfsShareApi = capturedProviderProps?.vfsShareApi as {
      deleteShare: (
        shareId: string,
        itemId?: string
      ) => Promise<{
        deleted: boolean;
      }>;
    };

    await vfsShareApi.deleteShare('share-1');

    expect(mockDeleteShare).toHaveBeenCalledWith('share-1');
    expect(mockRotateItemKeyEpochAndPersist).not.toHaveBeenCalled();
  });

  it('throws when key manager is not initialized during revoke', async () => {
    mockUseVfsKeyManager.mockReturnValue(null);

    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const vfsShareApi = capturedProviderProps?.vfsShareApi as {
      deleteShare: (
        shareId: string,
        itemId?: string
      ) => Promise<{
        deleted: boolean;
      }>;
    };

    await expect(vfsShareApi.deleteShare('share-1', 'item-1')).rejects.toThrow(
      'VFS key manager is not initialized'
    );
    expect(mockRotateItemKeyEpochAndPersist).not.toHaveBeenCalled();
  });

  it('exposes syncRemoteState that syncs remote and hydrates local read model', async () => {
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
    mockUseVfsOrchestratorInstance.mockReturnValue({ syncCrdt });

    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const syncRemoteState = capturedProviderProps?.['syncRemoteState'];

    expect(typeof syncRemoteState).toBe('function');
    if (typeof syncRemoteState !== 'function') {
      throw new Error('Expected syncRemoteState callback');
    }
    await syncRemoteState();
    expect(syncCrdt).toHaveBeenCalledTimes(1);
    expect(mockHydrateLocalReadModelFromRemoteFeeds).toHaveBeenCalledTimes(1);
  });

  it('skips syncRemoteState hydration when orchestrator is unavailable', async () => {
    mockUseVfsOrchestratorInstance.mockReturnValue(null);

    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const syncRemoteState = capturedProviderProps?.['syncRemoteState'];
    if (typeof syncRemoteState !== 'function') {
      throw new Error('Expected syncRemoteState callback');
    }

    await syncRemoteState();
    expect(mockHydrateLocalReadModelFromRemoteFeeds).not.toHaveBeenCalled();
  });

  it('ignores already-registered conflicts for vfsApi.register', async () => {
    const conflictError = new Error('Conflict');
    Reflect.set(conflictError, 'status', 409);
    api.vfs.register.mockRejectedValueOnce(conflictError);

    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const vfsApi = capturedProviderProps?.vfsApi as {
      register: (input: {
        id: string;
        objectType: string;
        encryptedSessionKey: string;
      }) => Promise<void>;
    };

    await expect(
      vfsApi.register({
        id: 'folder-1',
        objectType: 'folder',
        encryptedSessionKey: 'wrapped'
      })
    ).resolves.toBeUndefined();
  });

  it('rethrows non-conflict vfsApi.register failures', async () => {
    api.vfs.register.mockRejectedValueOnce(new Error('register boom'));

    render(
      <ClientVfsExplorerProvider>
        <div>child</div>
      </ClientVfsExplorerProvider>
    );

    const vfsApi = capturedProviderProps?.vfsApi as {
      register: (input: {
        id: string;
        objectType: string;
        encryptedSessionKey: string;
      }) => Promise<void>;
    };

    await expect(
      vfsApi.register({
        id: 'folder-2',
        objectType: 'folder',
        encryptedSessionKey: 'wrapped'
      })
    ).rejects.toThrow('register boom');
  });
});
