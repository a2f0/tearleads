import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPostgresPoolMock, queryMock, requireVfsClaimsMock } = vi.hoisted(
  () => ({
    getPostgresPoolMock: vi.fn(),
    queryMock: vi.fn(),
    requireVfsClaimsMock: vi.fn()
  })
);

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { getMyKeysDirect, setupKeysDirect } from './vfsDirectKeys.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

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

    expect(parseJson(response.json)).toEqual({
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
          json: '{}'
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
          json: '{"publicEncryptionKey":"enc","publicSigningKey":"sign","encryptedPrivateKeys":"priv","argon2Salt":"salt"}'
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

  it('stores keys when user has none', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: []
    });

    const response = await setupKeysDirect(
      {
        json: '{"publicEncryptionKey":"enc","publicSigningKey":"sign","encryptedPrivateKeys":"priv","argon2Salt":"salt"}'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      created: true
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
