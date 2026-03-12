import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  queueItemUpsertAndFlush,
  setVfsItemSyncRuntime
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
const { getDatabaseMock, mockGetInstanceChangeSnapshot, selectLimitMock } =
  vi.hoisted(() => {
    const selectLimitMock = vi.fn();
    const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
    const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
    const selectMock = vi.fn(() => ({ from: selectFromMock }));
    const getDatabaseMock = vi.fn(() => ({
      select: selectMock,
      update: vi.fn()
    }));
    const mockGetInstanceChangeSnapshot = vi.fn(() => ({
      currentInstanceId: 'instance-1',
      instanceEpoch: 1
    }));

    return {
      getDatabaseMock,
      mockGetInstanceChangeSnapshot,
      selectLimitMock
    };
  });

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

describe('vfsItemSyncWriter instance switching', () => {
  beforeEach(() => {
    setVfsItemSyncRuntime(null);
    isLoggedInMock.mockReset();
    readStoredAuthMock.mockReset();
    getFeatureFlagValueMock.mockReset();
    registerMock.mockReset();
    getDatabaseMock.mockClear();
    mockGetInstanceChangeSnapshot.mockReset();
    selectLimitMock.mockReset();

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

  it('rejects writes when the active instance no longer matches the bound runtime', async () => {
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
      queueEncryptedCrdtOpAndPersist,
      currentInstanceId: 'instance-1',
      instanceEpoch: 1
    });
    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId: 'instance-2',
      instanceEpoch: 2
    });

    await expect(
      queueItemUpsertAndFlush({
        itemId: 'item-1',
        objectType: 'contact',
        encryptedSessionKey: 'wrapped',
        payload: { id: 'item-1' }
      })
    ).rejects.toThrow('VFS sync runtime is stale during preflight');

    expect(registerMock).not.toHaveBeenCalled();
    expect(queueEncryptedCrdtOpAndPersist).not.toHaveBeenCalled();
    expect(flushAll).not.toHaveBeenCalled();
  });

  it('still fires flush when runtime goes stale mid-operation (flush is fire-and-forget)', async () => {
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
      queueEncryptedCrdtOpAndPersist,
      currentInstanceId: 'instance-1',
      instanceEpoch: 1
    });
    mockGetInstanceChangeSnapshot
      .mockReturnValueOnce({
        currentInstanceId: 'instance-1',
        instanceEpoch: 1
      })
      .mockReturnValueOnce({
        currentInstanceId: 'instance-1',
        instanceEpoch: 1
      })
      .mockReturnValueOnce({
        currentInstanceId: 'instance-2',
        instanceEpoch: 2
      });

    await queueItemUpsertAndFlush({
      itemId: 'item-1',
      objectType: 'contact',
      encryptedSessionKey: 'wrapped',
      payload: { id: 'item-1' }
    });

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(queueEncryptedCrdtOpAndPersist).toHaveBeenCalledTimes(1);
    expect(flushAll).toHaveBeenCalledTimes(1);
  });
});
