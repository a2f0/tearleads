import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPoolMock, getPostgresPoolMock, queryMock, requireMlsClaimsMock } =
  vi.hoisted(() => ({
    getPoolMock: vi.fn(),
    getPostgresPoolMock: vi.fn(),
    queryMock: vi.fn(),
    requireMlsClaimsMock: vi.fn()
  }));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  acknowledgeWelcomeDirect,
  getWelcomeMessagesDirect
} from './mlsDirectWelcomeMessages.js';

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

describe('mlsDirectWelcomeMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    getPostgresPoolMock.mockReset();
    requireMlsClaimsMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    requireMlsClaimsMock.mockResolvedValue({ sub: 'user-1' });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns pending welcome messages', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'welcome-1',
          group_id: 'group-1',
          group_name: 'Group One',
          welcome_data: 'welcome',
          key_package_ref: 'ref-1',
          epoch: 2,
          created_at: new Date('2026-03-03T03:20:00.000Z')
        }
      ]
    });

    const response = await getWelcomeMessagesDirect(
      {},
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      welcomes: [
        {
          id: 'welcome-1',
          groupId: 'group-1',
          groupName: 'Group One',
          welcome: 'welcome',
          keyPackageRef: 'ref-1',
          epoch: 2,
          createdAt: '2026-03-03T03:20:00.000Z'
        }
      ]
    });
  });

  it('maps welcome list query failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('list failed'));

    await expect(
      getWelcomeMessagesDirect({}, { requestHeader: new Headers() })
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('acknowledges welcome messages for the current user', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const response = await acknowledgeWelcomeDirect(
      {
        id: 'welcome-1',
        json: '{"groupId":"group-1"}'
      },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({ acknowledged: true });
  });

  it('rejects invalid acknowledge payloads', async () => {
    await expect(
      acknowledgeWelcomeDirect(
        {
          id: 'welcome-1',
          json: '{}'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns not found when acknowledge update affects no rows', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });

    await expect(
      acknowledgeWelcomeDirect(
        {
          id: 'welcome-1',
          json: '{"groupId":"group-1"}'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('maps acknowledge failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('ack failed'));

    await expect(
      acknowledgeWelcomeDirect(
        {
          id: 'welcome-1',
          json: '{"groupId":"group-1"}'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
