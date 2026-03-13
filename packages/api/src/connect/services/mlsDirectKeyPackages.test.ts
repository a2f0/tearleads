import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const queryMock = vi.fn();
const randomUuidMock = vi.fn();
const requireMlsClaimsMock = vi.fn();

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => randomUuidMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  deleteKeyPackageDirectTyped,
  getMyKeyPackagesDirectTyped,
  getUserKeyPackagesDirectTyped,
  uploadKeyPackagesDirectTyped
} from './mlsDirectKeyPackages.js';

const textEncoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('mlsDirectKeyPackages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    getPostgresPoolMock.mockReset();
    randomUuidMock.mockReset();
    requireMlsClaimsMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    randomUuidMock.mockReturnValue('kp-1');
    requireMlsClaimsMock.mockResolvedValue({ sub: 'user-1' });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('uploads key packages and skips conflicts', async () => {
    randomUuidMock.mockReturnValueOnce('kp-1').mockReturnValueOnce('kp-2');
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'kp-1',
          key_package_data: base64('data-1'),
          key_package_ref: 'ref-1',
          cipher_suite: 1,
          created_at: new Date('2026-03-03T03:00:00.000Z')
        }
      ]
    });

    const response = await uploadKeyPackagesDirectTyped(
      {
        keyPackages: [
          {
            keyPackageData: bytes('data-1'),
            keyPackageRef: 'ref-1',
            cipherSuite: 1
          },
          {
            keyPackageData: bytes('data-2'),
            keyPackageRef: 'ref-2',
            cipherSuite: 1
          }
        ]
      },
      { requestHeader: new Headers() }
    );

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM unnest('),
      [
        ['kp-1', 'kp-2'],
        [base64('data-1'), base64('data-2')],
        ['ref-1', 'ref-2'],
        [1, 1],
        'user-1'
      ]
    );

    expect(response).toEqual({
      keyPackages: [
        {
          id: 'kp-1',
          userId: 'user-1',
          keyPackageData: bytes('data-1'),
          keyPackageRef: 'ref-1',
          cipherSuite: 1,
          createdAt: '2026-03-03T03:00:00.000Z',
          consumed: false
        }
      ]
    });
  });

  it('rejects upload with invalid payload', async () => {
    await expect(
      uploadKeyPackagesDirectTyped(
        {
          keyPackages: []
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps upload query failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      uploadKeyPackagesDirectTyped(
        {
          keyPackages: [
            {
              keyPackageData: bytes('data-1'),
              keyPackageRef: 'ref-1',
              cipherSuite: 1
            }
          ]
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('returns current user key packages', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'kp-1',
          key_package_data: base64('data-1'),
          key_package_ref: 'ref-1',
          cipher_suite: 1,
          created_at: new Date('2026-03-03T03:05:00.000Z'),
          consumed_at: null
        },
        {
          id: 'kp-2',
          key_package_data: base64('data-2'),
          key_package_ref: 'ref-2',
          cipher_suite: 2,
          created_at: new Date('2026-03-03T03:06:00.000Z'),
          consumed_at: new Date('2026-03-03T03:07:00.000Z')
        }
      ]
    });

    const response = await getMyKeyPackagesDirectTyped(
      {},
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      keyPackages: [
        {
          id: 'kp-1',
          userId: 'user-1',
          keyPackageData: bytes('data-1'),
          keyPackageRef: 'ref-1',
          cipherSuite: 1,
          createdAt: '2026-03-03T03:05:00.000Z',
          consumed: false
        },
        {
          id: 'kp-2',
          userId: 'user-1',
          keyPackageData: bytes('data-2'),
          keyPackageRef: 'ref-2',
          cipherSuite: 3,
          createdAt: '2026-03-03T03:06:00.000Z',
          consumed: true
        }
      ]
    });
  });

  it('returns not found when target user is not in a shared organization', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getUserKeyPackagesDirectTyped(
        {
          userId: 'user-2'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('returns target user key packages when org is shared', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce({
      rows: [
        {
          id: 'kp-3',
          key_package_data: base64('data-3'),
          key_package_ref: 'ref-3',
          cipher_suite: 1,
          created_at: new Date('2026-03-03T03:10:00.000Z')
        }
      ]
    });

    const response = await getUserKeyPackagesDirectTyped(
      {
        userId: 'user-2'
      },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      keyPackages: [
        {
          id: 'kp-3',
          userId: 'user-2',
          keyPackageData: bytes('data-3'),
          keyPackageRef: 'ref-3',
          cipherSuite: 1,
          createdAt: '2026-03-03T03:10:00.000Z',
          consumed: false
        }
      ]
    });
  });

  it('maps getUserKeyPackages failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('query failed'));

    await expect(
      getUserKeyPackagesDirectTyped(
        {
          userId: 'user-2'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('deletes key packages owned by the caller', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const response = await deleteKeyPackageDirectTyped(
      {
        id: 'kp-1'
      },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({});
  });

  it('returns not found when key package delete affects no rows', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });

    await expect(
      deleteKeyPackageDirectTyped(
        {
          id: 'missing'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('maps delete failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('delete failed'));

    await expect(
      deleteKeyPackageDirectTyped(
        {
          id: 'kp-1'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
