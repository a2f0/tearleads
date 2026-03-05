import type { MlsV2Routes } from '@tearleads/api-client/mlsRoutes';
import { Code, ConnectError } from '@connectrpc/connect';
import { describe, expect, it, vi } from 'vitest';
import {
  recoverMissingGroupState,
  uploadGroupStateSnapshot
} from './groupStateSync.js';

interface TestClient {
  hasGroup: ReturnType<typeof vi.fn>;
  importGroupState: ReturnType<typeof vi.fn>;
  exportGroupState: ReturnType<typeof vi.fn>;
  getGroupEpoch: ReturnType<typeof vi.fn>;
}

function createClient(): TestClient {
  return {
    hasGroup: vi.fn(),
    importGroupState: vi.fn(),
    exportGroupState: vi.fn(),
    getGroupEpoch: vi.fn()
  };
}

function createMockRoutes(
  overrides: Partial<MlsV2Routes> = {}
): MlsV2Routes {
  const notImplemented = () => {
    throw new Error('Not mocked');
  };
  return {
    listGroups: notImplemented,
    getGroup: notImplemented,
    createGroup: notImplemented,
    updateGroup: notImplemented,
    leaveGroup: notImplemented,
    getGroupMembers: notImplemented,
    addGroupMember: notImplemented,
    removeGroupMember: notImplemented,
    getGroupMessages: notImplemented,
    sendGroupMessage: notImplemented,
    getGroupState: notImplemented,
    uploadGroupState: notImplemented,
    getMyKeyPackages: notImplemented,
    getUserKeyPackages: notImplemented,
    uploadKeyPackages: notImplemented,
    deleteKeyPackage: notImplemented,
    getWelcomeMessages: notImplemented,
    acknowledgeWelcome: notImplemented,
    ...overrides
  };
}

describe('groupStateSync', () => {
  it('recovers missing group state and imports it locally', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);
    client.importGroupState.mockResolvedValue(undefined);
    const serializedState = 'serialized-state';
    const stateHash = 'X/wnNsA+qEvj1bbVUIls8zjTa/wKOz17TEK532YZY1U=';

    const mlsRoutes = createMockRoutes({
      getGroupState: vi.fn().mockResolvedValue({
        state: {
          id: 'state-1',
          groupId: 'group-1',
          epoch: 4,
          encryptedState: btoa(serializedState),
          stateHash,
          createdAt: new Date().toISOString()
        }
      })
    });

    const recovered = await recoverMissingGroupState({
      groupId: 'group-1',
      client,
      mlsRoutes
    });

    expect(recovered).toBe(true);
    expect(client.importGroupState).toHaveBeenCalledTimes(1);
    expect(client.importGroupState.mock.calls[0]?.[0]).toBe('group-1');
    const importedBytes = client.importGroupState.mock.calls[0]?.[1] as
      | Uint8Array
      | undefined;
    expect(importedBytes).toBeDefined();
    expect(Array.from(importedBytes ?? new Uint8Array())).toEqual(
      Array.from(new TextEncoder().encode(serializedState))
    );
  });

  it('rejects recovered state when the state hash does not match', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);

    const mlsRoutes = createMockRoutes({
      getGroupState: vi.fn().mockResolvedValue({
        state: {
          id: 'state-1',
          groupId: 'group-1',
          epoch: 4,
          encryptedState: btoa('serialized-state'),
          stateHash: 'invalid-state-hash',
          createdAt: new Date().toISOString()
        }
      })
    });

    await expect(
      recoverMissingGroupState({
        groupId: 'group-1',
        client,
        mlsRoutes
      })
    ).rejects.toThrow('MLS group state hash mismatch');

    expect(client.importGroupState).not.toHaveBeenCalled();
  });

  it('returns false when server has no snapshot', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);

    const mlsRoutes = createMockRoutes({
      getGroupState: vi.fn().mockResolvedValue({ state: null })
    });

    const recovered = await recoverMissingGroupState({
      groupId: 'group-1',
      client,
      mlsRoutes
    });

    expect(recovered).toBe(false);
    expect(client.importGroupState).not.toHaveBeenCalled();
  });

  it('returns false when server returns NotFound', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);

    const mlsRoutes = createMockRoutes({
      getGroupState: vi.fn().mockRejectedValue(
        new ConnectError('not found', Code.NotFound)
      )
    });

    const recovered = await recoverMissingGroupState({
      groupId: 'group-1',
      client,
      mlsRoutes
    });

    expect(recovered).toBe(false);
    expect(client.importGroupState).not.toHaveBeenCalled();
  });

  it('returns false when server returns PermissionDenied', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);

    const mlsRoutes = createMockRoutes({
      getGroupState: vi.fn().mockRejectedValue(
        new ConnectError('forbidden', Code.PermissionDenied)
      )
    });

    const recovered = await recoverMissingGroupState({
      groupId: 'group-1',
      client,
      mlsRoutes
    });

    expect(recovered).toBe(false);
  });

  it('uploads current group snapshot when group is available', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(true);
    client.getGroupEpoch.mockReturnValue(7);
    client.exportGroupState.mockResolvedValue(
      new TextEncoder().encode('state-bytes')
    );

    const uploadGroupStateSpy = vi.fn().mockResolvedValue({
      state: {
        id: 'state-1',
        groupId: 'group-1',
        epoch: 7,
        encryptedState: btoa('state-bytes'),
        stateHash: 'wAEDKaM8s6FdpeNW0sAr8nS7ZQCBwhZ0F3ClXnVBabQ=',
        createdAt: new Date().toISOString()
      }
    });

    const mlsRoutes = createMockRoutes({
      uploadGroupState: uploadGroupStateSpy
    });

    await uploadGroupStateSnapshot({
      groupId: 'group-1',
      client,
      mlsRoutes
    });

    expect(uploadGroupStateSpy).toHaveBeenCalledTimes(1);
    expect(uploadGroupStateSpy).toHaveBeenCalledWith('group-1', {
      epoch: 7,
      encryptedState: expect.any(String),
      stateHash: 'wAEDKaM8s6FdpeNW0sAr8nS7ZQCBwhZ0F3ClXnVBabQ='
    });
  });

  it('ignores conflict on upload (AlreadyExists)', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(true);
    client.getGroupEpoch.mockReturnValue(7);
    client.exportGroupState.mockResolvedValue(
      new TextEncoder().encode('state-bytes')
    );

    const mlsRoutes = createMockRoutes({
      uploadGroupState: vi.fn().mockRejectedValue(
        new ConnectError('conflict', Code.AlreadyExists)
      )
    });

    await expect(
      uploadGroupStateSnapshot({
        groupId: 'group-1',
        client,
        mlsRoutes
      })
    ).resolves.toBeUndefined();
  });
});
