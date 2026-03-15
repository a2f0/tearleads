import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPostgresPoolMock = vi.fn();
const queryMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  getMyKeysDirect,
  getUserSigningKeyDirect,
  setupKeysDirect
} from './vfsDirectKeys.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPostgresPoolMock.mockReset();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns not found when user keys are missing', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getMyKeysDirect(
        {},
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns user key payload when keys exist', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          public_encryption_key: 'enc-key',
          public_signing_key: 'sign-key',
          encrypted_private_keys: 'priv-keys',
          argon2_salt: 'salt-1'
        }
      ]
    });

    const response = await getMyKeysDirect(
      {},
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      publicEncryptionKey: 'enc-key',
      publicSigningKey: 'sign-key',
      encryptedPrivateKeys: 'priv-keys',
      argon2Salt: 'salt-1'
    });
  });

  it('rejects setupKeys when payload is invalid', async () => {
    await expect(
      setupKeysDirect(
        {
          publicEncryptionKey: '',
          publicSigningKey: '',
          encryptedPrivateKeys: '',
          argon2Salt: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps existing keys to AlreadyExists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ one: 1 }] });

    await expect(
      setupKeysDirect(
        {
          publicEncryptionKey: 'enc',
          publicSigningKey: 'sign',
          encryptedPrivateKeys: 'priv',
          argon2Salt: 'salt'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  describe('getUserSigningKeyDirect', () => {
    it('rejects when userId is missing', async () => {
      await expect(
        getUserSigningKeyDirect(
          { userId: '' },
          { requestHeader: new Headers() }
        )
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
    });

    it('returns not found when user has no signing key', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        getUserSigningKeyDirect(
          { userId: 'user-2' },
          { requestHeader: new Headers() }
        )
      ).rejects.toMatchObject({ code: Code.NotFound });
    });

    it('returns the signing key for a valid user', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ public_signing_key: 'ed25519-pub-key' }]
      });

      const response = await getUserSigningKeyDirect(
        { userId: 'user-2' },
        { requestHeader: new Headers() }
      );

      expect(response).toEqual({
        userId: 'user-2',
        publicSigningKey: 'ed25519-pub-key'
      });
    });
  });

  it('stores keys when user has none', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: []
    });

    const response = await setupKeysDirect(
      {
        publicEncryptionKey: 'enc',
        publicSigningKey: 'sign',
        encryptedPrivateKeys: 'priv',
        argon2Salt: 'salt'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      created: true
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
