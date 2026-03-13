import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSyncActivity,
  queueItemDeleteAndFlush,
  queueItemUpsertAndFlush,
  setVfsItemSyncRuntime,
  subscribeSyncActivity,
  withDownloadTracking
} from './vfsItemSyncWriter';

const isLoggedInMock = vi.fn(() => false);
const readStoredAuthMock = vi.fn(() => ({
  token: 'token-1',
  refreshToken: 'refresh-token-1',
  user: {
    id: 'user-1',
    email: 'user-1@example.com'
  }
}));
const getFeatureFlagValueMock = vi.fn(() => true);
const registerMock = vi.fn();
const selectLimitMock = vi.fn();
const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
const selectMock = vi.fn(() => ({ from: selectFromMock }));
const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));
const getDatabaseMock = vi.fn(() => ({
  select: selectMock,
  update: updateMock
}));
const mockGetInstanceChangeSnapshot = vi.fn(() => ({
  currentInstanceId: 'instance-1',
  instanceEpoch: 1
}));

vi.mock('@/lib/authStorage', () => ({
  isLoggedIn: () => isLoggedInMock(),
  readStoredAuth: () => readStoredAuthMock()
}));

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlagValue: () => getFeatureFlagValueMock('vfsServerRegistration')
}));

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      register: (...args: unknown[]) => registerMock(...args)
    }
  }
}));

vi.mock('@/db', () => ({
  getDatabase: () => getDatabaseMock()
}));

vi.mock('@/hooks/app/useInstanceChange', () => ({
  getInstanceChangeSnapshot: () => mockGetInstanceChangeSnapshot()
}));

function setMockSyncRuntime(input: {
  flushAll: ReturnType<typeof vi.fn>;
  queueCrdtLocalOperationAndPersist: ReturnType<typeof vi.fn>;
  queueEncryptedCrdtOpAndPersist: ReturnType<typeof vi.fn>;
  currentInstanceId?: string | null;
  instanceEpoch?: number;
}): void {
  setVfsItemSyncRuntime({
    currentInstanceId: input.currentInstanceId ?? 'instance-1',
    instanceEpoch: input.instanceEpoch ?? 1,
    orchestrator: {
      flushAll: input.flushAll,
      queueCrdtLocalOperationAndPersist: input.queueCrdtLocalOperationAndPersist
    },
    secureFacade: {
      queueEncryptedCrdtOpAndPersist: input.queueEncryptedCrdtOpAndPersist
    }
  });
}

describe('vfsItemSyncWriter', () => {
  beforeEach(() => {
    setVfsItemSyncRuntime(null);
    isLoggedInMock.mockReset();
    readStoredAuthMock.mockReset();
    getFeatureFlagValueMock.mockReset();
    registerMock.mockReset();
    getDatabaseMock.mockClear();
    mockGetInstanceChangeSnapshot.mockReset();
    selectLimitMock.mockReset();
    updateWhereMock.mockReset();

    readStoredAuthMock.mockReturnValue({
      token: 'token-1',
      refreshToken: 'refresh-token-1',
      user: {
        id: 'user-1',
        email: 'user-1@example.com'
      }
    });
    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId: 'instance-1',
      instanceEpoch: 1
    });
    selectLimitMock.mockResolvedValue([]);
  });

  it('does nothing when user is signed out', async () => {
    isLoggedInMock.mockReturnValue(false);
    getFeatureFlagValueMock.mockReturnValue(true);

    await expect(
      queueItemUpsertAndFlush({
        itemId: 'item-1',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'item-1' }
      })
    ).resolves.toBeUndefined();

    expect(registerMock).not.toHaveBeenCalled();
  });

  it('throws when signed-in sync is enabled but runtime is not initialized', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);

    await expect(
      queueItemUpsertAndFlush({
        itemId: 'item-1',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'item-1' }
      })
    ).rejects.toThrow(
      'VFS sync runtime is not initialized while signed-in item sync is enabled'
    );
  });

  it('queues encrypted item_upsert and flushes', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    registerMock.mockResolvedValue(undefined);

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 1, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    await queueItemUpsertAndFlush({
      itemId: 'item-1',
      objectType: 'contact',
      encryptedSessionKey: 'wrapped',
      payload: { id: 'item-1', firstName: 'Ada' }
    });

    expect(registerMock).toHaveBeenCalledWith({
      id: 'item-1',
      objectType: 'contact',
      encryptedSessionKey: 'wrapped'
    });
    expect(queueEncryptedCrdtOpAndPersist).toHaveBeenCalledWith({
      itemId: 'item-1',
      opType: 'item_upsert',
      opPayload: { id: 'item-1', firstName: 'Ada' }
    });
    expect(flushAll).toHaveBeenCalledTimes(1);
  });

  it('treats already-registered response as success', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    registerMock.mockRejectedValue(new Error('Item already registered in VFS'));

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 1, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    await expect(
      queueItemUpsertAndFlush({
        itemId: 'item-1',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'item-1' }
      })
    ).resolves.toBeUndefined();

    expect(queueEncryptedCrdtOpAndPersist).toHaveBeenCalledTimes(1);
    expect(flushAll).toHaveBeenCalledTimes(1);
  });

  it('treats register conflict status as success', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    const conflictError = new Error('API error: 409');
    Reflect.set(conflictError, 'status', 409);
    registerMock.mockRejectedValue(conflictError);

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 1, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    await expect(
      queueItemUpsertAndFlush({
        itemId: 'item-1',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'item-1' }
      })
    ).resolves.toBeUndefined();

    expect(queueEncryptedCrdtOpAndPersist).toHaveBeenCalledTimes(1);
    expect(flushAll).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers during inflight transitions on upsert', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    registerMock.mockResolvedValue(undefined);

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 1, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    const snapshots: Array<{
      uploadInflightCount: number;
      downloadInflightCount: number;
      lastSyncError: Error | null;
    }> = [];
    const unsubscribe = subscribeSyncActivity(() => {
      snapshots.push(getSyncActivity());
    });

    await queueItemUpsertAndFlush({
      itemId: 'item-1',
      objectType: 'contact',
      encryptedSessionKey: 'wrapped',
      payload: { id: 'item-1' }
    });

    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]?.uploadInflightCount).toBe(1);
    expect(snapshots[snapshots.length - 1]?.uploadInflightCount).toBe(0);
    expect(snapshots[snapshots.length - 1]?.lastSyncError).toBeNull();
  });

  it('tracks error state on sync failure', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    registerMock.mockRejectedValue(new Error('Network failure'));

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 0, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    await expect(
      queueItemUpsertAndFlush({
        itemId: 'new-item',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'new-item' }
      })
    ).rejects.toThrow('Network failure');

    const activity = getSyncActivity();
    expect(activity.uploadInflightCount).toBe(0);
    expect(activity.lastSyncError).toBeInstanceOf(Error);
    expect(activity.lastSyncError?.message).toBe('Network failure');
  });

  it('clears error on subsequent success', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 1, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    registerMock.mockRejectedValueOnce(new Error('Temporary failure'));
    await expect(
      queueItemUpsertAndFlush({
        itemId: 'fail-item',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'fail-item' }
      })
    ).rejects.toThrow('Temporary failure');

    expect(getSyncActivity().lastSyncError).not.toBeNull();

    registerMock.mockResolvedValueOnce(undefined);
    await queueItemUpsertAndFlush({
      itemId: 'ok-item',
      objectType: 'contact',
      encryptedSessionKey: 'wrapped',
      payload: { id: 'ok-item' }
    });

    expect(getSyncActivity().lastSyncError).toBeNull();
  });

  it('resets sync activity when runtime is set to null', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    registerMock.mockRejectedValue(new Error('fail'));

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 0, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    await expect(
      queueItemUpsertAndFlush({
        itemId: 'x',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'x' }
      })
    ).rejects.toThrow();

    expect(getSyncActivity().lastSyncError).not.toBeNull();

    const listener = vi.fn();
    const unsub = subscribeSyncActivity(listener);
    setVfsItemSyncRuntime(null);
    unsub();

    expect(listener).toHaveBeenCalled();
    expect(getSyncActivity().uploadInflightCount).toBe(0);
    expect(getSyncActivity().downloadInflightCount).toBe(0);
    expect(getSyncActivity().lastSyncError).toBeNull();
  });

  it('tracks downloadInflightCount via withDownloadTracking', async () => {
    const snapshots: Array<{
      uploadInflightCount: number;
      downloadInflightCount: number;
      lastSyncError: Error | null;
    }> = [];
    const unsubscribe = subscribeSyncActivity(() => {
      snapshots.push(getSyncActivity());
    });

    await withDownloadTracking(async () => {
      const mid = getSyncActivity();
      expect(mid.downloadInflightCount).toBe(1);
      expect(mid.uploadInflightCount).toBe(0);
    });

    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]?.downloadInflightCount).toBe(1);
    expect(snapshots[snapshots.length - 1]?.downloadInflightCount).toBe(0);
    expect(snapshots[snapshots.length - 1]?.lastSyncError).toBeNull();
  });

  it('tracks error state on download failure', async () => {
    await expect(
      withDownloadTracking(async () => {
        throw new Error('Download failure');
      })
    ).rejects.toThrow('Download failure');

    const activity = getSyncActivity();
    expect(activity.downloadInflightCount).toBe(0);
    expect(activity.lastSyncError).toBeInstanceOf(Error);
    expect(activity.lastSyncError?.message).toBe('Download failure');
  });

  it('queues item_delete and flushes', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    registerMock.mockResolvedValue(undefined);

    const queueEncryptedCrdtOpAndPersist = vi.fn().mockResolvedValue(undefined);
    const queueCrdtLocalOperationAndPersist = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 1, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });

    setMockSyncRuntime({
      flushAll,
      queueCrdtLocalOperationAndPersist,
      queueEncryptedCrdtOpAndPersist
    });

    await queueItemDeleteAndFlush({
      itemId: 'item-1',
      objectType: 'note',
      encryptedSessionKey: 'wrapped'
    });

    expect(queueCrdtLocalOperationAndPersist).toHaveBeenCalledWith({
      itemId: 'item-1',
      opType: 'item_delete'
    });
    expect(flushAll).toHaveBeenCalledTimes(1);
  });
});
