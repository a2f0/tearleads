import { describe, expect, it } from 'vitest';
import {
  buildVfsCrdtSyncQuery,
  mapVfsCrdtSyncRows,
  parseVfsCrdtSyncQuery,
  type VfsCrdtSyncDbRow
} from './sync-crdt-feed.js';
import { decodeVfsSyncCursor } from './sync-cursor.js';

describe('parseVfsCrdtSyncQuery', () => {
  it('uses defaults when query is empty', () => {
    const result = parseVfsCrdtSyncQuery({});

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
    const result = parseVfsCrdtSyncQuery({
      limit: '0'
    });

    expect(result).toEqual({
      ok: false,
      error: 'limit must be an integer between 1 and 500'
    });
  });

  it('returns error for invalid cursor format', () => {
    const result = parseVfsCrdtSyncQuery({
      cursor: 'bad-cursor'
    });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid cursor'
    });
  });
});

describe('buildVfsCrdtSyncQuery', () => {
  it('builds parameterized query with cursor and root scope', () => {
    const query = buildVfsCrdtSyncQuery({
      userId: 'user-1',
      limit: 25,
      cursor: {
        changedAt: '2026-02-14T00:00:00.000Z',
        changeId: 'op-1'
      },
      rootId: 'root-1'
    });

    expect(query.values).toEqual([
      'user-1',
      '2026-02-14T00:00:00.000Z',
      'op-1',
      26,
      'root-1'
    ]);
    expect(query.text).toContain('ORDER BY ops.occurred_at ASC, ops.id ASC');
  });
});

describe('mapVfsCrdtSyncRows', () => {
  it('paginates rows and emits nextCursor from last returned op', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-1',
        item_id: 'item-1',
        op_type: 'acl_add',
        principal_type: 'user',
        principal_id: 'user-2',
        access_level: 'write',
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-1',
        occurred_at: new Date('2026-02-14T00:00:00.000Z')
      },
      {
        op_id: 'op-2',
        item_id: 'item-1',
        op_type: 'acl_remove',
        principal_type: 'user',
        principal_id: 'user-2',
        access_level: null,
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-1',
        occurred_at: new Date('2026-02-14T00:00:01.000Z')
      }
    ];

    const result = mapVfsCrdtSyncRows(rows, 1);

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.lastReconciledWriteIds).toEqual({});
    expect(result.nextCursor).not.toBeNull();
    if (!result.nextCursor) {
      throw new Error('Expected nextCursor');
    }

    expect(decodeVfsSyncCursor(result.nextCursor)).toEqual({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-1'
    });
  });

  it('includes provided replica write ids in response payload', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-1',
        item_id: 'item-1',
        op_type: 'acl_add',
        principal_type: 'user',
        principal_id: 'user-2',
        access_level: 'write',
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-1',
        occurred_at: new Date('2026-02-14T00:00:00.000Z')
      }
    ];

    const result = mapVfsCrdtSyncRows(rows, 10, {
      desktop: 4,
      mobile: 2
    });

    expect(result.lastReconciledWriteIds).toEqual({
      desktop: 4,
      mobile: 2
    });
  });

  it('throws when rows violate ordering guardrail', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-2',
        item_id: 'item-1',
        op_type: 'acl_add',
        principal_type: 'user',
        principal_id: 'user-2',
        access_level: 'write',
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-1',
        occurred_at: new Date('2026-02-14T00:00:01.000Z')
      },
      {
        op_id: 'op-1',
        item_id: 'item-1',
        op_type: 'acl_add',
        principal_type: 'user',
        principal_id: 'user-2',
        access_level: 'write',
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-1',
        occurred_at: new Date('2026-02-14T00:00:00.000Z')
      }
    ];

    expect(() => mapVfsCrdtSyncRows(rows, 10)).toThrowError(
      /violates required ordering/
    );
  });

  it('throws when duplicate op ids are present', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-1',
        item_id: 'item-1',
        op_type: 'acl_add',
        principal_type: 'user',
        principal_id: 'user-2',
        access_level: 'write',
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-1',
        occurred_at: new Date('2026-02-14T00:00:00.000Z')
      },
      {
        op_id: 'op-1',
        item_id: 'item-2',
        op_type: 'acl_remove',
        principal_type: 'user',
        principal_id: 'user-3',
        access_level: null,
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-2',
        occurred_at: new Date('2026-02-14T00:00:01.000Z')
      }
    ];

    expect(() => mapVfsCrdtSyncRows(rows, 10)).toThrowError(/repeats op_id/);
  });

  it('throws when link rows have mismatched child scope', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-link-1',
        item_id: 'item-1',
        op_type: 'link_add',
        principal_type: null,
        principal_id: null,
        access_level: null,
        parent_id: 'parent-1',
        child_id: 'item-2',
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'user-1:desktop:1:op-link-1',
        occurred_at: new Date('2026-02-14T00:00:00.000Z')
      }
    ];

    expect(() => mapVfsCrdtSyncRows(rows, 10)).toThrowError(
      /invalid link payload/
    );
  });

  it('throws when link rows are self-referential', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-link-2',
        item_id: 'item-1',
        op_type: 'link_add',
        principal_type: null,
        principal_id: null,
        access_level: null,
        parent_id: 'item-1',
        child_id: 'item-1',
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'user-1:desktop:2:op-link-2',
        occurred_at: new Date('2026-02-14T00:00:01.000Z')
      }
    ];

    expect(() => mapVfsCrdtSyncRows(rows, 10)).toThrowError(
      /invalid link payload/
    );
  });

  it('allows encrypted link rows without plaintext parent/child fields', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-link-enc-1',
        item_id: 'item-1',
        op_type: 'link_add',
        principal_type: null,
        principal_id: null,
        access_level: null,
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'user-1:desktop:3:op-link-enc-1',
        occurred_at: new Date('2026-02-14T00:00:01.000Z'),
        encrypted_payload: 'base64-ciphertext',
        key_epoch: 3,
        encryption_nonce: 'base64-nonce',
        encryption_aad: 'base64-aad',
        encryption_signature: 'base64-signature'
      }
    ];

    const result = mapVfsCrdtSyncRows(rows, 10);
    expect(result.items).toEqual([
      {
        opId: 'op-link-enc-1',
        itemId: 'item-1',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'user-1:desktop:3:op-link-enc-1',
        occurredAt: '2026-02-14T00:00:01.000Z',
        encryptedPayload: 'base64-ciphertext',
        keyEpoch: 3,
        encryptionNonce: 'base64-nonce',
        encryptionAad: 'base64-aad',
        encryptionSignature: 'base64-signature'
      }
    ]);
  });

  it('throws when encrypted rows have invalid key epoch metadata', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-enc-1',
        item_id: 'item-1',
        op_type: 'acl_add',
        principal_type: null,
        principal_id: null,
        access_level: null,
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'user-1:desktop:1:op-enc-1',
        occurred_at: new Date('2026-02-14T00:00:00.000Z'),
        encrypted_payload: 'base64-ciphertext',
        key_epoch: null
      }
    ];

    expect(() => mapVfsCrdtSyncRows(rows, 10)).toThrowError(
      /invalid encrypted envelope metadata/
    );
  });

  it('normalizes unexpected enum values', () => {
    const rows: VfsCrdtSyncDbRow[] = [
      {
        op_id: 'op-9',
        item_id: 'item-9',
        op_type: 'unknown-op',
        principal_type: 'unknown-principal',
        principal_id: 'user-2',
        access_level: 'unknown-level',
        parent_id: null,
        child_id: null,
        actor_id: 'user-1',
        source_table: 'vfs_crdt_client_push',
        source_id: 'share-9',
        occurred_at: new Date('2026-02-14T00:00:00.000Z')
      }
    ];

    const result = mapVfsCrdtSyncRows(rows, 10);
    expect(result.items).toEqual([
      {
        opId: 'op-9',
        itemId: 'item-9',
        opType: 'acl_add',
        principalType: null,
        principalId: 'user-2',
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'share-9',
        occurredAt: '2026-02-14T00:00:00.000Z'
      }
    ]);
  });
});
