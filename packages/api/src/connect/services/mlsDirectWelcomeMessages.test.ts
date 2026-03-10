import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const queryMock = vi.fn();
const requireMlsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  acknowledgeWelcomeDirectTyped,
  getWelcomeMessagesDirectTyped
} from './mlsDirectWelcomeMessages.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

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

    const response = await getWelcomeMessagesDirectTyped(
      {},
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
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
      getWelcomeMessagesDirectTyped({}, { requestHeader: new Headers() })
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('acknowledges welcome messages for the current user', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const response = await acknowledgeWelcomeDirectTyped(
      {
        id: 'welcome-1',
        groupId: 'group-1'
      },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({ acknowledged: true });
  });

  it('rejects invalid acknowledge payloads', async () => {
    await expect(
      acknowledgeWelcomeDirectTyped(
        {
          id: 'welcome-1',
          groupId: ''
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns not found when acknowledge update affects no rows', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });

    await expect(
      acknowledgeWelcomeDirectTyped(
        {
          id: 'welcome-1',
          groupId: 'group-1'
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
      acknowledgeWelcomeDirectTyped(
        {
          id: 'welcome-1',
          groupId: 'group-1'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
