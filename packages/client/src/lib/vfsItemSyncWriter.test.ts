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
const getFeatureFlagValueMock = vi.fn(() => true);
const registerMock = vi.fn();

vi.mock('@/lib/authStorage', () => ({
  isLoggedIn: () => isLoggedInMock()
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

describe('vfsItemSyncWriter', () => {
  beforeEach(() => {
    setVfsItemSyncRuntime(null);
    isLoggedInMock.mockReset();
    getFeatureFlagValueMock.mockReset();
    registerMock.mockReset();
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

    setVfsItemSyncRuntime({
      orchestrator: { flushAll, queueCrdtLocalOperationAndPersist },
      secureFacade: { queueEncryptedCrdtOpAndPersist }
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

    setVfsItemSyncRuntime({
      orchestrator: { flushAll, queueCrdtLocalOperationAndPersist },
      secureFacade: { queueEncryptedCrdtOpAndPersist }
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

    setVfsItemSyncRuntime({
      orchestrator: { flushAll, queueCrdtLocalOperationAndPersist },
      secureFacade: { queueEncryptedCrdtOpAndPersist }
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

    setVfsItemSyncRuntime({
      orchestrator: { flushAll, queueCrdtLocalOperationAndPersist },
      secureFacade: { queueEncryptedCrdtOpAndPersist }
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

    setVfsItemSyncRuntime({
      orchestrator: { flushAll, queueCrdtLocalOperationAndPersist },
      secureFacade: { queueEncryptedCrdtOpAndPersist }
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

    setVfsItemSyncRuntime({
      orchestrator: { flushAll, queueCrdtLocalOperationAndPersist },
      secureFacade: { queueEncryptedCrdtOpAndPersist }
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

    setVfsItemSyncRuntime({
      orchestrator: { flushAll, queueCrdtLocalOperationAndPersist },
      secureFacade: { queueEncryptedCrdtOpAndPersist }
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
