import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPoolMock,
  getPostgresPoolMock,
  queryMock,
  randomUuidMock,
  requireMlsClaimsMock
} = vi.hoisted(() => ({
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  queryMock: vi.fn(),
  randomUuidMock: vi.fn(),
  requireMlsClaimsMock: vi.fn()
}));

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
  deleteKeyPackageDirect,
  getMyKeyPackagesDirect,
  getUserKeyPackagesDirect,
  uploadKeyPackagesDirect
} from './mlsDirectKeyPackages.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected object JSON response');
  }
  return parsed;
}

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
    queryMock
      .mockResolvedValueOnce({
        rows: [{ created_at: new Date('2026-03-03T03:00:00.000Z') }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const response = await uploadKeyPackagesDirect(
      {
        json: '{"keyPackages":[{"keyPackageData":"data-1","keyPackageRef":"ref-1","cipherSuite":1},{"keyPackageData":"data-2","keyPackageRef":"ref-2","cipherSuite":1}]}'
      },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      keyPackages: [
        {
          id: 'kp-1',
          userId: 'user-1',
          keyPackageData: 'data-1',
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
      uploadKeyPackagesDirect(
        {
          json: '{}'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps upload query failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      uploadKeyPackagesDirect(
        {
          json: '{"keyPackages":[{"keyPackageData":"data-1","keyPackageRef":"ref-1","cipherSuite":1}]}'
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
          key_package_data: 'data-1',
          key_package_ref: 'ref-1',
          cipher_suite: 1,
          created_at: new Date('2026-03-03T03:05:00.000Z'),
          consumed_at: null
        },
        {
          id: 'kp-2',
          key_package_data: 'data-2',
          key_package_ref: 'ref-2',
          cipher_suite: 2,
          created_at: new Date('2026-03-03T03:06:00.000Z'),
          consumed_at: new Date('2026-03-03T03:07:00.000Z')
        }
      ]
    });

    const response = await getMyKeyPackagesDirect(
      {},
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      keyPackages: [
        {
          id: 'kp-1',
          userId: 'user-1',
          keyPackageData: 'data-1',
          keyPackageRef: 'ref-1',
          cipherSuite: 1,
          createdAt: '2026-03-03T03:05:00.000Z',
          consumed: false
        },
        {
          id: 'kp-2',
          userId: 'user-1',
          keyPackageData: 'data-2',
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
      getUserKeyPackagesDirect(
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
          key_package_data: 'data-3',
          key_package_ref: 'ref-3',
          cipher_suite: 1,
          created_at: new Date('2026-03-03T03:10:00.000Z')
        }
      ]
    });

    const response = await getUserKeyPackagesDirect(
      {
        userId: 'user-2'
      },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      keyPackages: [
        {
          id: 'kp-3',
          userId: 'user-2',
          keyPackageData: 'data-3',
          keyPackageRef: 'ref-3',
          cipherSuite: 1,
          createdAt: '2026-03-03T03:10:00.000Z',
          consumed: false
        }
      ]
    });
  });

  it('deletes key packages owned by the caller', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const response = await deleteKeyPackageDirect(
      {
        id: 'kp-1'
      },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({ json: '{}' });
  });

  it('returns not found when key package delete affects no rows', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });

    await expect(
      deleteKeyPackageDirect(
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
      deleteKeyPackageDirect(
        {
          id: 'kp-1'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
