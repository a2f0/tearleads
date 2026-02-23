import { describe, expect, it } from 'vitest';
import { decodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  buildVfsSyncQuery,
  mapVfsSyncRows,
  parseVfsSyncQuery,
  type VfsSyncDbRow
} from './sync-engine.js';

describe('parseVfsSyncQuery', () => {
  it('uses defaults when query is empty', () => {
    const result = parseVfsSyncQuery({});

    expect(result).toEqual({
      ok: true,
      value: {
        limit: 100,
        cursor: null,
        rootId: null
      }
    });
  });

  it('returns error for invalid limit', () => {
    const result = parseVfsSyncQuery({
      limit: '0'
    });

    expect(result).toEqual({
      ok: false,
      error: 'limit must be an integer between 1 and 500'
    });
  });

  it('returns error for invalid cursor format', () => {
    const result = parseVfsSyncQuery({
      cursor: 'bad-cursor'
    });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid cursor'
    });
  });

  it('returns error for non-string query values', () => {
    const result = parseVfsSyncQuery({
      rootId: ['x']
    });

    expect(result).toEqual({
      ok: false,
      error: 'rootId must be a string'
    });
  });
});

describe('buildVfsSyncQuery', () => {
  it('builds parameterized query with cursor and root scope', () => {
    const query = buildVfsSyncQuery({
      userId: 'user-1',
      limit: 25,
      cursor: {
        changedAt: '2025-01-01T00:00:00.000Z',
        changeId: 'change-1'
      },
      rootId: 'root-1'
    });

    expect(query.values).toEqual([
      'user-1',
      '2025-01-01T00:00:00.000Z',
      'change-1',
      26,
      'root-1'
    ]);
  });

  it('contains stable tie-breaker logic for concurrent writes', () => {
    const query = buildVfsSyncQuery({
      userId: 'user-1',
      limit: 10,
      cursor: null,
      rootId: null
    });

    expect(query.text).toContain('change_row.changed_at > $2::timestamptz');
    expect(query.text).toContain("change_row.id > COALESCE($3::text, '')");
    expect(query.text).toContain(
      'ORDER BY change_row.changed_at ASC, change_row.id ASC'
    );
  });
});

describe('mapVfsSyncRows', () => {
  it('paginates rows and emits nextCursor from the last returned row', () => {
    const rows: VfsSyncDbRow[] = [
      {
        change_id: 'change-1',
        item_id: 'item-1',
        change_type: 'upsert',
        changed_at: new Date('2025-01-01T00:00:00.000Z'),
        object_type: 'folder',
        owner_id: 'user-1',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        access_level: 'admin'
      },
      {
        change_id: 'change-2',
        item_id: 'item-2',
        change_type: 'acl',
        changed_at: new Date('2025-01-01T00:00:00.000Z'),
        object_type: 'note',
        owner_id: 'user-1',
        created_at: new Date('2024-01-02T00:00:00.000Z'),
        access_level: 'write'
      },
      {
        change_id: 'change-3',
        item_id: 'item-3',
        change_type: 'delete',
        changed_at: new Date('2025-01-01T00:00:01.000Z'),
        object_type: null,
        owner_id: null,
        created_at: null,
        access_level: 'read'
      }
    ];

    const result = mapVfsSyncRows(rows, 2);

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    if (!result.nextCursor) {
      throw new Error('Expected nextCursor');
    }

    expect(decodeVfsSyncCursor(result.nextCursor)).toEqual({
      changedAt: '2025-01-01T00:00:00.000Z',
      changeId: 'change-2'
    });
  });

  it('normalizes unexpected enum values', () => {
    const rows: VfsSyncDbRow[] = [
      {
        change_id: 'change-1',
        item_id: 'item-1',
        change_type: 'unknown',
        changed_at: new Date('2025-01-01T00:00:00.000Z'),
        object_type: 'unknown',
        owner_id: 'user-1',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        access_level: 'unknown'
      }
    ];

    const result = mapVfsSyncRows(rows, 10);

    expect(result.items[0]).toEqual({
      changeId: 'change-1',
      itemId: 'item-1',
      changeType: 'upsert',
      changedAt: '2025-01-01T00:00:00.000Z',
      objectType: null,
      ownerId: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      accessLevel: 'read'
    });
  });

  it('treats email as a standard VFS object type in the generic feed', () => {
    const rows: VfsSyncDbRow[] = [
      {
        change_id: 'change-email-1',
        item_id: 'email-1',
        change_type: 'upsert',
        changed_at: new Date('2026-02-14T11:30:00.000Z'),
        object_type: 'email',
        owner_id: 'user-1',
        created_at: new Date('2026-02-14T11:00:00.000Z'),
        access_level: 'write'
      }
    ];

    const result = mapVfsSyncRows(rows, 10);

    expect(result).toEqual({
      items: [
        {
          changeId: 'change-email-1',
          itemId: 'email-1',
          changeType: 'upsert',
          changedAt: '2026-02-14T11:30:00.000Z',
          objectType: 'email',
          ownerId: 'user-1',
          createdAt: '2026-02-14T11:00:00.000Z',
          accessLevel: 'write'
        }
      ],
      nextCursor: null,
      hasMore: false
    });
  });

  it('throws when changed_at is invalid', () => {
    const rows: VfsSyncDbRow[] = [
      {
        change_id: 'change-1',
        item_id: 'item-1',
        change_type: 'upsert',
        changed_at: 'not-a-date',
        object_type: 'folder',
        owner_id: 'user-1',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        access_level: 'admin'
      }
    ];

    expect(() => mapVfsSyncRows(rows, 10)).toThrowError(
      /has invalid changed_at/
    );
  });

  it('throws when rows arrive out of order', () => {
    const rows: VfsSyncDbRow[] = [
      {
        change_id: 'change-2',
        item_id: 'item-2',
        change_type: 'upsert',
        changed_at: new Date('2025-01-01T00:00:01.000Z'),
        object_type: 'folder',
        owner_id: 'user-1',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        access_level: 'admin'
      },
      {
        change_id: 'change-1',
        item_id: 'item-1',
        change_type: 'upsert',
        changed_at: new Date('2025-01-01T00:00:00.000Z'),
        object_type: 'folder',
        owner_id: 'user-1',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        access_level: 'admin'
      }
    ];

    expect(() => mapVfsSyncRows(rows, 10)).toThrowError(
      /violates required ordering/
    );
  });

  it('throws when duplicate change ids are present', () => {
    const rows: VfsSyncDbRow[] = [
      {
        change_id: 'change-1',
        item_id: 'item-1',
        change_type: 'upsert',
        changed_at: new Date('2025-01-01T00:00:00.000Z'),
        object_type: 'folder',
        owner_id: 'user-1',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        access_level: 'admin'
      },
      {
        change_id: 'change-1',
        item_id: 'item-1',
        change_type: 'upsert',
        changed_at: new Date('2025-01-01T00:00:01.000Z'),
        object_type: 'folder',
        owner_id: 'user-1',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        access_level: 'admin'
      }
    ];

    expect(() => mapVfsSyncRows(rows, 10)).toThrowError(/repeats change_id/);
  });
});
