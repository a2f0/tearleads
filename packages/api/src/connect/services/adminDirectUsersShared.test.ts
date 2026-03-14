import { describe, expect, it, vi } from 'vitest';
import {
  getUserAccounting,
  mapUserRow,
  parseUserUpdatePayload
} from './adminDirectUsersShared.js';

describe('admin users shared', () => {
  it('maps user rows with sensible defaults', () => {
    const mapped = mapUserRow({
      id: 'user-1',
      email: 'user-1@example.com',
      email_confirmed: true,
      admin: false,
      organization_ids: null,
      created_at: new Date('2026-03-03T00:00:00.000Z'),
      disabled: false
    });

    expect(mapped.organizationIds).toEqual([]);
    expect(mapped.createdAt).toBe('2026-03-03T00:00:00.000Z');
    expect(mapped.accounting.totalTokens).toBe(0);
  });

  it('returns empty accounting map when no users are provided', async () => {
    const query = vi.fn();
    const pool = { query };

    const result = await getUserAccounting(pool as never, []);

    expect(result).toEqual({});
    expect(query).not.toHaveBeenCalled();
  });

  it('maps accounting rows by user id', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          user_id: 'user-1',
          total_prompt_tokens: '11',
          total_completion_tokens: '22',
          total_tokens: '33',
          request_count: '2',
          last_used_at: new Date('2026-03-03T00:00:00.000Z')
        }
      ]
    });

    const result = await getUserAccounting({ query } as never, [
      'user-1',
      'user-2'
    ]);

    expect(query.mock.calls[0]?.[0]).toContain(
      'WHERE user_id = ANY($1::uuid[])'
    );
    expect(query.mock.calls[0]?.[1]).toEqual([['user-1', 'user-2']]);
    expect(result['user-1']).toEqual({
      totalPromptTokens: 11,
      totalCompletionTokens: 22,
      totalTokens: 33,
      requestCount: 2,
      lastUsedAt: '2026-03-03T00:00:00.000Z'
    });
  });

  it('parses valid update payloads', () => {
    expect(
      parseUserUpdatePayload({
        email: ' USER@EXAMPLE.COM ',
        emailConfirmed: true,
        admin: false,
        organizationIds: [' org-1 ', 'org-1', 'org-2'],
        disabled: true,
        markedForDeletion: false
      })
    ).toEqual({
      email: 'user@example.com',
      emailConfirmed: true,
      admin: false,
      organizationIds: ['org-1', 'org-2'],
      disabled: true,
      markedForDeletion: false
    });
  });

  it('rejects invalid update payloads and empty updates', () => {
    expect(parseUserUpdatePayload(null)).toBeNull();
    expect(parseUserUpdatePayload({})).toBeNull();
    expect(parseUserUpdatePayload({ email: '' })).toBeNull();
    expect(parseUserUpdatePayload({ emailConfirmed: 'yes' })).toBeNull();
    expect(parseUserUpdatePayload({ admin: 'no' })).toBeNull();
    expect(parseUserUpdatePayload({ organizationIds: 'org-1' })).toBeNull();
    expect(
      parseUserUpdatePayload({ organizationIds: ['org-1', 3] })
    ).toBeNull();
    expect(parseUserUpdatePayload({ disabled: 'no' })).toBeNull();
    expect(parseUserUpdatePayload({ markedForDeletion: 'no' })).toBeNull();
  });
});
