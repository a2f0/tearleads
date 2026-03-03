import { MLS_CIPHERSUITES } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveMlsGroupMembership,
  parseAckWelcomePayload,
  parseAddMemberPayload,
  parseCreateGroupPayload,
  parseRemoveMemberPayload,
  parseSendMessagePayload,
  parseUpdateGroupPayload,
  parseUploadKeyPackagesPayload,
  parseUploadStatePayload,
  toSafeCipherSuite
} from './mlsDirectShared.js';

const { getPostgresPoolMock } = vi.hoisted(() => ({
  getPostgresPoolMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

describe('mlsDirectShared', () => {
  beforeEach(() => {
    getPostgresPoolMock.mockReset();
  });

  it('normalizes cipher suite values safely', () => {
    expect(toSafeCipherSuite(MLS_CIPHERSUITES.X25519_AES128GCM)).toBe(
      MLS_CIPHERSUITES.X25519_AES128GCM
    );

    expect(toSafeCipherSuite('invalid')).toBe(
      MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
    );
  });

  it('parses upload key package payloads and rejects invalid payloads', () => {
    expect(
      parseUploadKeyPackagesPayload({
        keyPackages: [
          {
            keyPackageData: ' kp-data ',
            keyPackageRef: ' kp-ref ',
            cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
          }
        ]
      })
    ).toEqual({
      keyPackages: [
        {
          keyPackageData: 'kp-data',
          keyPackageRef: 'kp-ref',
          cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
        }
      ]
    });

    expect(parseUploadKeyPackagesPayload({ keyPackages: [] })).toBeNull();
    expect(
      parseUploadKeyPackagesPayload({
        keyPackages: Array.from({ length: 101 }).map(() => ({
          keyPackageData: 'a',
          keyPackageRef: 'b',
          cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
        }))
      })
    ).toBeNull();
  });

  it('parses group payloads', () => {
    expect(
      parseCreateGroupPayload({
        name: ' Team ',
        description: ' Desc ',
        groupIdMls: ' group-1 ',
        cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
      })
    ).toEqual({
      name: 'Team',
      description: 'Desc',
      groupIdMls: 'group-1',
      cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
    });

    expect(
      parseCreateGroupPayload({ name: '', groupIdMls: 'g', cipherSuite: 1 })
    ).toBeNull();

    expect(
      parseUpdateGroupPayload({
        name: ' Next ',
        description: ' updated '
      })
    ).toEqual({ name: 'Next', description: 'updated' });

    expect(parseUpdateGroupPayload({ name: '   ' })).toBeNull();
    expect(parseUpdateGroupPayload({})).toBeNull();
  });

  it('parses member mutation payloads', () => {
    expect(
      parseAddMemberPayload({
        userId: ' user-1 ',
        commit: ' commit ',
        welcome: ' welcome ',
        keyPackageRef: ' ref ',
        newEpoch: 2
      })
    ).toEqual({
      userId: 'user-1',
      commit: 'commit',
      welcome: 'welcome',
      keyPackageRef: 'ref',
      newEpoch: 2
    });

    expect(
      parseAddMemberPayload({
        userId: 'u',
        commit: 'c',
        welcome: 'w',
        keyPackageRef: 'r',
        newEpoch: -1
      })
    ).toBeNull();

    expect(
      parseRemoveMemberPayload({
        commit: ' commit ',
        newEpoch: 4
      })
    ).toEqual({ commit: 'commit', newEpoch: 4 });

    expect(parseRemoveMemberPayload({ commit: ' ', newEpoch: 1 })).toBeNull();
  });

  it('parses message/state/welcome payloads', () => {
    expect(
      parseSendMessagePayload({
        ciphertext: ' payload ',
        epoch: 3,
        messageType: 'application',
        contentType: ' text/plain '
      })
    ).toEqual({
      ciphertext: 'payload',
      epoch: 3,
      messageType: 'application',
      contentType: 'text/plain'
    });

    expect(
      parseSendMessagePayload({
        ciphertext: 'c',
        epoch: 1,
        messageType: 'invalid'
      })
    ).toBeNull();

    expect(
      parseUploadStatePayload({
        epoch: 8,
        encryptedState: ' encrypted ',
        stateHash: ' hash '
      })
    ).toEqual({
      epoch: 8,
      encryptedState: 'encrypted',
      stateHash: 'hash'
    });

    expect(
      parseUploadStatePayload({ epoch: 1, encryptedState: '', stateHash: 'h' })
    ).toBeNull();
    expect(parseAckWelcomePayload({ groupId: ' group-1 ' })).toEqual({
      groupId: 'group-1'
    });
    expect(parseAckWelcomePayload({ groupId: '' })).toBeNull();
  });

  it('loads active MLS group membership when row is valid', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          role: 'admin',
          organization_id: 'org-1'
        }
      ]
    });
    getPostgresPoolMock.mockResolvedValue({ query });

    await expect(
      getActiveMlsGroupMembership('group-1', 'user-1')
    ).resolves.toEqual({
      role: 'admin',
      organizationId: 'org-1'
    });
  });

  it('returns null for missing or invalid membership rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ role: 'owner', organization_id: 'org-1' }]
      });
    getPostgresPoolMock.mockResolvedValue({ query });

    await expect(
      getActiveMlsGroupMembership('group-1', 'user-1')
    ).resolves.toBeNull();
    await expect(
      getActiveMlsGroupMembership('group-1', 'user-1')
    ).resolves.toBeNull();
  });
});
