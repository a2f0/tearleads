import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  queueItemDeleteAndFlush,
  queueItemUpsertAndFlush,
  setVfsItemSyncRuntime
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
