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
const {
  getDatabaseMock,
  mockGetInstanceChangeSnapshot,
  selectLimitMock,
  updateWhereMock
} = vi.hoisted(() => {
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

  return {
    getDatabaseMock,
    mockGetInstanceChangeSnapshot,
    selectLimitMock,
    updateWhereMock
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
}): void {
  setVfsItemSyncRuntime({
    currentInstanceId: 'instance-1',
    instanceEpoch: 1,
    orchestrator: {
      flushAll: input.flushAll,
      queueCrdtLocalOperationAndPersist: input.queueCrdtLocalOperationAndPersist
    },
    secureFacade: {
      queueEncryptedCrdtOpAndPersist: input.queueEncryptedCrdtOpAndPersist
    }
  });
}

describe('vfsItemSyncWriter note ownership paths', () => {
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

  it('queues note upsert as base64 UTF-8 payload for read-model materialization', async () => {
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
      itemId: 'note-1',
      objectType: 'note',
      encryptedSessionKey: 'wrapped',
      payload: { content: 'Alice note update' }
    });

    const encodedPayload = Buffer.from('Alice note update', 'utf8').toString(
      'base64'
    );
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(queueEncryptedCrdtOpAndPersist).not.toHaveBeenCalled();
    expect(queueCrdtLocalOperationAndPersist).toHaveBeenCalledWith({
      itemId: 'note-1',
      opType: 'item_upsert',
      encryptedPayload: encodedPayload,
      keyEpoch: 1,
      encryptionNonce: Buffer.from(
        `nonce:note-1:${encodedPayload}`,
        'utf8'
      ).toString('base64'),
      encryptionAad: Buffer.from(
        `aad:note-1:${encodedPayload}`,
        'utf8'
      ).toString('base64'),
      encryptionSignature: Buffer.from(
        `signature:note-1:${encodedPayload}`,
        'utf8'
      ).toString('base64')
    });
    expect(flushAll).toHaveBeenCalledTimes(1);
  });

  it('skips register for non-owned shared note items', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    readStoredAuthMock.mockReturnValue({
      token: 'token-1',
      refreshToken: 'refresh-token-1',
      user: {
        id: 'alice-user-id',
        email: 'alice@example.com'
      }
    });
    selectLimitMock.mockResolvedValue([
      {
        objectType: 'note',
        encryptedSessionKey: 'shared-wrapped-key',
        ownerId: 'bob-user-id'
      }
    ]);

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
      itemId: 'shared-note-1',
      objectType: 'note',
      encryptedSessionKey: 'shared-wrapped-key',
      payload: { content: 'Alice edit' }
    });

    expect(registerMock).not.toHaveBeenCalled();
    expect(queueEncryptedCrdtOpAndPersist).not.toHaveBeenCalled();
    expect(queueCrdtLocalOperationAndPersist).toHaveBeenCalledTimes(1);
    expect(updateWhereMock).not.toHaveBeenCalled();
  });

  it('allows non-owned shared items missing encrypted session key', async () => {
    isLoggedInMock.mockReturnValue(true);
    getFeatureFlagValueMock.mockReturnValue(true);
    readStoredAuthMock.mockReturnValue({
      token: 'token-1',
      refreshToken: 'refresh-token-1',
      user: {
        id: 'alice-user-id',
        email: 'alice@example.com'
      }
    });
    selectLimitMock.mockResolvedValue([
      {
        objectType: 'note',
        encryptedSessionKey: null,
        ownerId: 'bob-user-id'
      }
    ]);

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
        itemId: 'shared-note-2',
        objectType: 'note',
        payload: { content: 'Alice edit' }
      })
    ).resolves.toBeUndefined();

    const encodedPayload = Buffer.from('Alice edit', 'utf8').toString('base64');
    expect(registerMock).not.toHaveBeenCalled();
    expect(queueEncryptedCrdtOpAndPersist).not.toHaveBeenCalled();
    expect(queueCrdtLocalOperationAndPersist).toHaveBeenCalledWith({
      itemId: 'shared-note-2',
      opType: 'item_upsert',
      encryptedPayload: encodedPayload,
      keyEpoch: 1,
      encryptionNonce: Buffer.from(
        `nonce:shared-note-2:${encodedPayload}`,
        'utf8'
      ).toString('base64'),
      encryptionAad: Buffer.from(
        `aad:shared-note-2:${encodedPayload}`,
        'utf8'
      ).toString('base64'),
      encryptionSignature: Buffer.from(
        `signature:shared-note-2:${encodedPayload}`,
        'utf8'
      ).toString('base64')
    });
    expect(updateWhereMock).not.toHaveBeenCalled();
    expect(flushAll).toHaveBeenCalledTimes(1);
  });
});
