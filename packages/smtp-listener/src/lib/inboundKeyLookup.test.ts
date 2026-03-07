import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetModulesIfSupported } from '../test/bunCompat.js';
import { withHoisted } from '../test/withHoisted.js';

const { getPostgresPoolMock, poolQueryMock } = withHoisted(() => ({
  getPostgresPoolMock: vi.fn(),
  poolQueryMock: vi.fn()
}));

vi.mock('./postgres.js', () => ({
  getPostgresPool: getPostgresPoolMock
}));

describe('PostgresInboundRecipientKeyLookup', () => {
  beforeEach(() => {
    resetModulesIfSupported();
    vi.clearAllMocks();
    getPostgresPoolMock.mockResolvedValue({ query: poolQueryMock });
  });

  it('returns empty map without querying when no user ids are provided', async () => {
    const { PostgresInboundRecipientKeyLookup } = await import(
      './inboundKeyLookup.js'
    );

    const result =
      await new PostgresInboundRecipientKeyLookup().getPublicEncryptionKeys([]);

    expect(result.size).toBe(0);
    expect(getPostgresPoolMock).not.toHaveBeenCalled();
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it('dedupes user ids and filters rows missing required values', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          user_id: 'user-1',
          public_encryption_key: 'pub-1',
          personal_organization_id: 'personal-org-user-1'
        },
        {
          user_id: 'user-2',
          public_encryption_key: '',
          personal_organization_id: 'personal-org-user-2'
        },
        {
          user_id: '',
          public_encryption_key: 'pub-3',
          personal_organization_id: 'personal-org-3'
        }
      ]
    });

    const { PostgresInboundRecipientKeyLookup } = await import(
      './inboundKeyLookup.js'
    );

    const result =
      await new PostgresInboundRecipientKeyLookup().getPublicEncryptionKeys([
        'user-1',
        'user-1',
        'user-2'
      ]);

    expect(getPostgresPoolMock).toHaveBeenCalledOnce();
    expect(poolQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM user_keys'),
      [['user-1', 'user-2']]
    );
    expect(result).toEqual(
      new Map([
        [
          'user-1',
          {
            userId: 'user-1',
            publicEncryptionKey: 'pub-1',
            organizationId: 'personal-org-user-1'
          }
        ]
      ])
    );
  });
});
