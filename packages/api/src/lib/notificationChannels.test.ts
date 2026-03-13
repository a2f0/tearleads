import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringifyJsonWithByteArrays } from '@tearleads/shared';
import {
  filterAuthorizedChannels,
  normalizeRequestedChannels,
  parseBroadcastMessage
} from './notificationChannels.js';

const mockQuery = vi.fn();

vi.mock('./postgres.js', () => ({
  getPostgresPool: vi.fn(() =>
    Promise.resolve({
      query: mockQuery
    })
  )
}));

describe('notificationChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('normalizeRequestedChannels', () => {
    it('defaults to broadcast when all channels are empty after trimming', () => {
      expect(normalizeRequestedChannels(['', '  '])).toEqual(['broadcast']);
    });

    it('trims and keeps non-empty channels', () => {
      expect(
        normalizeRequestedChannels(['  broadcast  ', ' mls:user:user-1 '])
      ).toEqual(['broadcast', 'mls:user:user-1']);
    });
  });

  describe('parseBroadcastMessage', () => {
    it('returns parsed message when payload shape is valid', () => {
      const parsed = parseBroadcastMessage(
        JSON.stringify({
          type: 'mls:message',
          payload: { id: 'msg-1' },
          timestamp: '2026-03-02T10:00:00.000Z'
        })
      );

      expect(parsed).toEqual({
        type: 'mls:message',
        payload: { id: 'msg-1' },
        timestamp: '2026-03-02T10:00:00.000Z'
      });
    });

    it('revives Uint8Array payload fields from JSON notifications', () => {
      const parsed = parseBroadcastMessage(
        stringifyJsonWithByteArrays({
          type: 'mls:message',
          payload: {
            ciphertext: Uint8Array.from([1, 2, 3])
          },
          timestamp: '2026-03-02T10:00:00.000Z'
        })
      );

      expect(parsed).toEqual({
        type: 'mls:message',
        payload: {
          ciphertext: Uint8Array.from([1, 2, 3])
        },
        timestamp: '2026-03-02T10:00:00.000Z'
      });
    });

    it('returns null for malformed or invalid payloads', () => {
      expect(parseBroadcastMessage('not-json')).toBeNull();
      expect(
        parseBroadcastMessage(
          JSON.stringify({
            type: 'missing-timestamp',
            payload: {}
          })
        )
      ).toBeNull();
    });
  });

  describe('filterAuthorizedChannels', () => {
    it('authorizes broadcast, own user channel, authorized group, and authorized vfs container', async () => {
      mockQuery.mockImplementation(
        async (
          sql: string
        ): Promise<{
          rows: Array<{ group_id?: string; item_id?: string }>;
        }> => {
          if (sql.includes('FROM vfs_acl_entries')) {
            return { rows: [{ item_id: 'container-1' }, { item_id: '  ' }] };
          }
          if (sql.includes('FROM mls_group_members')) {
            return { rows: [{ group_id: 'group-1' }, { group_id: '' }] };
          }
          return { rows: [] };
        }
      );

      const authorized = await filterAuthorizedChannels(
        [
          'broadcast',
          'mls:user:user-1',
          'mls:user:other-user',
          'mls:group:group-1',
          'mls:group:group-2',
          'vfs:container:container-1:sync',
          'vfs:container:container-2:sync',
          'unknown:channel'
        ],
        'user-1'
      );

      expect(authorized).toEqual([
        'broadcast',
        'mls:user:user-1',
        'mls:group:group-1',
        'vfs:container:container-1:sync'
      ]);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('skips database lookups when there are no MLS group or VFS channels', async () => {
      const authorized = await filterAuthorizedChannels(
        ['broadcast', 'mls:user:other-user'],
        'user-1'
      );

      expect(authorized).toEqual(['broadcast']);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
