import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from './mlsV2Binary';
import { createMlsV2Routes } from './mlsV2BinaryRoutes';
import type { MlsV2Routes as WireMlsV2Routes } from './mlsV2Routes';

const { createWireRoutesMock } = vi.hoisted(() => ({
  createWireRoutesMock: vi.fn()
}));

vi.mock('./mlsV2Routes', async () => {
  const actual =
    await vi.importActual<typeof import('./mlsV2Routes')>('./mlsV2Routes');
  return {
    ...actual,
    createMlsV2Routes: (...args: unknown[]) => createWireRoutesMock(...args)
  };
});

function createDefaultWireRoutes(
  overrides: Partial<WireMlsV2Routes> = {}
): WireMlsV2Routes {
  const defaultRoutes: WireMlsV2Routes = {
    listGroups: async () => ({ groups: [] }),
    getGroup: async () => ({
      group: {
        id: 'group-1',
        groupIdMls: 'group-id-mls',
        name: 'MLS Group',
        description: null,
        creatorUserId: 'user-1',
        currentEpoch: 1,
        cipherSuite: 3,
        createdAt: '2026-03-05T00:00:00.000Z',
        updatedAt: '2026-03-05T00:00:00.000Z'
      },
      members: []
    }),
    createGroup: async () => ({
      group: {
        id: 'group-1',
        groupIdMls: 'group-id-mls',
        name: 'MLS Group',
        description: null,
        creatorUserId: 'user-1',
        currentEpoch: 1,
        cipherSuite: 3,
        createdAt: '2026-03-05T00:00:00.000Z',
        updatedAt: '2026-03-05T00:00:00.000Z'
      }
    }),
    updateGroup: async () => ({
      group: {
        id: 'group-1',
        groupIdMls: 'group-id-mls',
        name: 'MLS Group',
        description: null,
        creatorUserId: 'user-1',
        currentEpoch: 1,
        cipherSuite: 3,
        createdAt: '2026-03-05T00:00:00.000Z',
        updatedAt: '2026-03-05T00:00:00.000Z'
      }
    }),
    leaveGroup: async () => undefined,
    getGroupMembers: async () => ({ members: [] }),
    addGroupMember: async () => ({
      member: {
        userId: 'user-2',
        email: 'user-2@example.com',
        leafIndex: 0,
        role: 'member',
        joinedAt: '2026-03-05T00:00:00.000Z',
        joinedAtEpoch: 1
      }
    }),
    removeGroupMember: async () => undefined,
    getGroupMessages: async () => ({
      messages: [],
      hasMore: false
    }),
    sendGroupMessage: async () => ({
      message: {
        id: 'msg-1',
        groupId: 'group-1',
        senderUserId: 'user-1',
        epoch: 1,
        ciphertext: '',
        messageType: 'application',
        contentType: 'text/plain',
        sequenceNumber: 1,
        sentAt: '2026-03-05T00:00:00.000Z',
        createdAt: '2026-03-05T00:00:00.000Z'
      }
    }),
    getGroupState: async () => ({ state: null }),
    uploadGroupState: async () => ({
      state: {
        id: 'state-1',
        groupId: 'group-1',
        epoch: 1,
        encryptedState: '',
        stateHash: 'hash',
        createdAt: '2026-03-05T00:00:00.000Z'
      }
    }),
    getMyKeyPackages: async () => ({ keyPackages: [] }),
    getUserKeyPackages: async () => ({ keyPackages: [] }),
    uploadKeyPackages: async () => ({ keyPackages: [] }),
    deleteKeyPackage: async () => undefined,
    getWelcomeMessages: async () => ({ welcomes: [] }),
    acknowledgeWelcome: async () => ({ acknowledged: true })
  };

  return {
    ...defaultRoutes,
    ...overrides
  };
}

describe('mlsV2BinaryRoutes', () => {
  it('encodes write payloads to base64 before delegating to wire routes', async () => {
    const addGroupMember: WireMlsV2Routes['addGroupMember'] = vi.fn(async () => ({
      member: {
        userId: 'user-2',
        email: 'user-2@example.com',
        leafIndex: 0,
        role: 'member',
        joinedAt: '2026-03-05T00:00:00.000Z',
        joinedAtEpoch: 2
      }
    }));
    const sendGroupMessage: WireMlsV2Routes['sendGroupMessage'] = vi.fn(
      async () => ({
        message: {
          id: 'msg-2',
          groupId: 'group-1',
          senderUserId: 'user-1',
          epoch: 2,
          ciphertext: bytesToBase64(Uint8Array.from([9, 8, 7])),
          messageType: 'application',
          contentType: 'text/plain',
          sequenceNumber: 2,
          sentAt: '2026-03-05T00:00:00.000Z',
          createdAt: '2026-03-05T00:00:00.000Z'
        }
      })
    );
    const uploadGroupState: WireMlsV2Routes['uploadGroupState'] = vi.fn(
      async () => ({
        state: {
          id: 'state-2',
          groupId: 'group-1',
          epoch: 2,
          encryptedState: bytesToBase64(Uint8Array.from([1, 2, 3, 4])),
          stateHash: 'hash-2',
          createdAt: '2026-03-05T00:00:00.000Z'
        }
      })
    );
    const uploadKeyPackages: WireMlsV2Routes['uploadKeyPackages'] = vi.fn(
      async () => ({
        keyPackages: []
      })
    );
    const removeGroupMember: WireMlsV2Routes['removeGroupMember'] = vi.fn(
      async () => undefined
    );

    createWireRoutesMock.mockReturnValue(
      createDefaultWireRoutes({
        addGroupMember,
        removeGroupMember,
        sendGroupMessage,
        uploadGroupState,
        uploadKeyPackages
      })
    );

    const routes = createMlsV2Routes();

    const commit = Uint8Array.from([1, 2, 3]);
    const welcome = Uint8Array.from([4, 5, 6]);
    const ciphertext = Uint8Array.from([9, 8, 7]);
    const encryptedState = Uint8Array.from([1, 2, 3, 4]);
    const keyPackageData = Uint8Array.from([8, 8, 8]);

    await routes.addGroupMember('group-1', {
      userId: 'user-2',
      commit,
      welcome,
      keyPackageRef: 'ref-1',
      newEpoch: 2
    });
    await routes.removeGroupMember('group-1', 'user-2', {
      commit,
      newEpoch: 3
    });
    await routes.sendGroupMessage('group-1', {
      ciphertext,
      epoch: 2,
      messageType: 'application'
    });
    await routes.uploadGroupState('group-1', {
      epoch: 2,
      encryptedState,
      stateHash: 'hash-2'
    });
    await routes.uploadKeyPackages({
      keyPackages: [
        {
          keyPackageData,
          keyPackageRef: 'kp-ref',
          cipherSuite: 3
        }
      ]
    });

    expect(addGroupMember).toHaveBeenCalledWith('group-1', {
      userId: 'user-2',
      commit: bytesToBase64(commit),
      welcome: bytesToBase64(welcome),
      keyPackageRef: 'ref-1',
      newEpoch: 2
    });
    expect(removeGroupMember).toHaveBeenCalledWith('group-1', 'user-2', {
      commit: bytesToBase64(commit),
      newEpoch: 3
    });
    expect(sendGroupMessage).toHaveBeenCalledWith('group-1', {
      ciphertext: bytesToBase64(ciphertext),
      epoch: 2,
      messageType: 'application'
    });
    expect(uploadGroupState).toHaveBeenCalledWith('group-1', {
      epoch: 2,
      encryptedState: bytesToBase64(encryptedState),
      stateHash: 'hash-2'
    });
    expect(uploadKeyPackages).toHaveBeenCalledWith({
      keyPackages: [
        {
          keyPackageData: bytesToBase64(keyPackageData),
          keyPackageRef: 'kp-ref',
          cipherSuite: 3
        }
      ]
    });
  });

  it('decodes read payloads from base64 to Uint8Array', async () => {
    const messageBytes = Uint8Array.from([10, 11, 12]);
    const stateBytes = Uint8Array.from([20, 21, 22]);
    const welcomeBytes = Uint8Array.from([30, 31, 32]);
    const keyPackageBytes = Uint8Array.from([40, 41, 42]);

    createWireRoutesMock.mockReturnValue(
      createDefaultWireRoutes({
        getGroupMessages: async () => ({
          messages: [
            {
              id: 'msg-1',
              groupId: 'group-1',
              senderUserId: 'user-1',
              epoch: 1,
              ciphertext: bytesToBase64(messageBytes),
              messageType: 'application',
              contentType: 'text/plain',
              sequenceNumber: 1,
              sentAt: '2026-03-05T00:00:00.000Z',
              createdAt: '2026-03-05T00:00:00.000Z'
            }
          ],
          hasMore: false
        }),
        getGroupState: async () => ({
          state: {
            id: 'state-1',
            groupId: 'group-1',
            epoch: 1,
            encryptedState: bytesToBase64(stateBytes),
            stateHash: 'hash-1',
            createdAt: '2026-03-05T00:00:00.000Z'
          }
        }),
        getWelcomeMessages: async () => ({
          welcomes: [
            {
              id: 'welcome-1',
              groupId: 'group-1',
              groupName: 'MLS Group',
              welcome: bytesToBase64(welcomeBytes),
              keyPackageRef: 'kp-ref',
              epoch: 1,
              createdAt: '2026-03-05T00:00:00.000Z'
            }
          ]
        }),
        getMyKeyPackages: async () => ({
          keyPackages: [
            {
              id: 'kp-1',
              userId: 'user-1',
              keyPackageData: bytesToBase64(keyPackageBytes),
              keyPackageRef: 'kp-ref',
              cipherSuite: 3,
              createdAt: '2026-03-05T00:00:00.000Z',
              consumed: false
            }
          ]
        })
      })
    );

    const routes = createMlsV2Routes();

    const messages = await routes.getGroupMessages('group-1');
    const state = await routes.getGroupState('group-1');
    const welcomes = await routes.getWelcomeMessages();
    const keyPackages = await routes.getMyKeyPackages();

    expect(Array.from(messages.messages[0]?.ciphertext ?? [])).toEqual(
      Array.from(messageBytes)
    );
    expect(Array.from(state.state?.encryptedState ?? [])).toEqual(
      Array.from(stateBytes)
    );
    expect(Array.from(welcomes.welcomes[0]?.welcome ?? [])).toEqual(
      Array.from(welcomeBytes)
    );
    expect(Array.from(keyPackages.keyPackages[0]?.keyPackageData ?? [])).toEqual(
      Array.from(keyPackageBytes)
    );
  });
});
