import { describe, expect, it } from 'vitest';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  parseApiPullResponse,
  parseApiPushResponse,
  parseApiReconcileResponse
} from './sync-http-transport-parser';

const OCCURRED_AT = '2026-02-21T10:00:00.000Z';
const OCCURRED_AT_MS = Date.parse(OCCURRED_AT);

function createEncryptedItem(keyEpoch: number): Record<string, unknown> {
  return {
    opId: encodeUtf8ToBase64('op-1'),
    itemId: encodeUtf8ToBase64('item-1'),
    opType: 'VFS_CRDT_OP_TYPE_ACL_ADD',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: null,
    childId: null,
    actorId: encodeUtf8ToBase64('user-1'),
    sourceTable: 'vfs_acl_entries',
    sourceId: encodeUtf8ToBase64('row-1'),
    occurredAtMs: String(OCCURRED_AT_MS),
    encryptedPayload: 'base64-ciphertext',
    keyEpoch
  };
}

function encodeUtf8ToBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

describe('sync-http-transport parser encrypted envelope keyEpoch', () => {
  it('applies protobuf default semantics when pull defaults are omitted', () => {
    const response = parseApiPullResponse({
      lastReconciledWriteIds: {}
    });

    expect(response).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {},
      bloomFilter: null
    });
  });

  it('rejects encrypted envelope with non-safe-integer keyEpoch', () => {
    expect(() =>
      parseApiPullResponse({
        items: [createEncryptedItem(Number.MAX_SAFE_INTEGER + 1)],
        nextCursor: null,
        hasMore: false,
        lastReconciledWriteIds: { 'client-1': 1 }
      })
    ).toThrow(/invalid encrypted envelope at items\[0\]/);
  });

  it('accepts encrypted envelope with safe-integer keyEpoch', () => {
    const response = parseApiPullResponse({
      items: [createEncryptedItem(3)],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: { 'client-1': 1 }
    });

    expect(response.items[0]?.keyEpoch).toBe(3);
    expect(response.items[0]?.encryptedPayload).toBe('base64-ciphertext');
  });

  it('treats empty optional enum/string fields as null', () => {
    const response = parseApiPullResponse({
      items: [
        {
          opId: encodeUtf8ToBase64('op-2'),
          itemId: encodeUtf8ToBase64('item-2'),
          opType: 'VFS_CRDT_OP_TYPE_ITEM_UPSERT',
          principalType: '',
          principalId: '',
          accessLevel: '',
          parentId: '',
          childId: '',
          actorId: '',
          sourceTable: 'vfs_item_state',
          sourceId: encodeUtf8ToBase64('row-2'),
          occurredAtMs: String(Date.parse('2026-02-21T10:00:01.000Z'))
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    expect(response.items[0]).toEqual(
      expect.objectContaining({
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: null
      })
    );
  });

  it('accepts link_reassign pull items', () => {
    const response = parseApiPullResponse({
      items: [
        {
          opId: encodeUtf8ToBase64('op-link-reassign-1'),
          itemId: encodeUtf8ToBase64('reading-1'),
          opType: 'VFS_CRDT_OP_TYPE_LINK_REASSIGN',
          parentId: encodeUtf8ToBase64('contact-2'),
          childId: encodeUtf8ToBase64('reading-1'),
          actorId: encodeUtf8ToBase64('user-1'),
          sourceTable: 'vfs_crdt_client_push',
          sourceId: encodeUtf8ToBase64('desktop:1'),
          occurredAtMs: String(Date.parse('2026-02-21T10:00:02.000Z'))
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    expect(response.items[0]).toEqual(
      expect.objectContaining({
        opType: 'link_reassign',
        parentId: 'contact-2',
        childId: 'reading-1'
      })
    );
  });

  it('rejects malformed link_reassign pull items', () => {
    expect(() =>
      parseApiPullResponse({
        items: [
          {
            opId: encodeUtf8ToBase64('op-link-reassign-2'),
            itemId: encodeUtf8ToBase64('reading-1'),
            opType: 'VFS_CRDT_OP_TYPE_LINK_REASSIGN',
            parentId: encodeUtf8ToBase64('contact-2'),
            childId: encodeUtf8ToBase64('reading-2'),
            actorId: encodeUtf8ToBase64('user-1'),
            sourceTable: 'vfs_crdt_client_push',
            sourceId: encodeUtf8ToBase64('desktop:2'),
            occurredAtMs: String(Date.parse('2026-02-21T10:00:03.000Z'))
          }
        ],
        nextCursor: null,
        hasMore: false,
        lastReconciledWriteIds: {}
      })
    ).toThrow(/invalid link payload at items\[0\]/);
  });

  it('parses canonical push response fields', () => {
    const response = parseApiPushResponse({
      clientId: encodeUtf8ToBase64('desktop'),
      results: [
        {
          opId: encodeUtf8ToBase64('desktop-1'),
          status: 'VFS_CRDT_PUSH_STATUS_APPLIED'
        }
      ]
    });

    expect(response).toEqual({
      clientId: 'desktop',
      results: [
        {
          opId: 'desktop-1',
          status: 'applied'
        }
      ]
    });
  });

  it('rejects legacy push response enum fields', () => {
    expect(() =>
      parseApiPushResponse({
        clientId: encodeUtf8ToBase64('desktop'),
        results: [
          {
            opId: encodeUtf8ToBase64('desktop-9'),
            status: 'applied'
          }
        ]
      })
    ).toThrow(/invalid results\[0\]\.status/);
  });

  it('parses canonical pull item fields', () => {
    const response = parseApiPullResponse({
      items: [
        {
          opId: encodeUtf8ToBase64('desktop-2'),
          itemId: encodeUtf8ToBase64('item-2'),
          opType: 'VFS_CRDT_OP_TYPE_ITEM_UPSERT',
          principalType: 'VFS_ACL_PRINCIPAL_TYPE_GROUP',
          principalId: encodeUtf8ToBase64('group-1'),
          accessLevel: 'VFS_ACL_ACCESS_LEVEL_WRITE',
          actorId: encodeUtf8ToBase64('user-1'),
          sourceTable: 'vfs_crdt_client_push',
          sourceId: encodeUtf8ToBase64('source-row-2'),
          occurredAtMs: '1740132001000'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    expect(response.items[0]).toEqual(
      expect.objectContaining({
        opId: 'desktop-2',
        itemId: 'item-2',
        opType: 'item_upsert',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write',
        actorId: 'user-1',
        sourceId: 'source-row-2',
        occurredAt: '2025-02-21T10:00:01.000Z'
      })
    );
  });

  it('rejects legacy pull item enum fields', () => {
    expect(() =>
      parseApiPullResponse({
        items: [
          {
            opId: encodeUtf8ToBase64('desktop-3'),
            itemId: encodeUtf8ToBase64('item-3'),
            opType: 'item_upsert',
            principalType: 'group',
            principalId: encodeUtf8ToBase64('group-2'),
            accessLevel: 'write',
            actorId: encodeUtf8ToBase64('user-2'),
            sourceTable: 'vfs_crdt_client_push',
            sourceId: encodeUtf8ToBase64('source-row-3'),
            occurredAtMs: 1740132002000
          }
        ],
        nextCursor: null,
        hasMore: false,
        lastReconciledWriteIds: {}
      })
    ).toThrow(/invalid items\[0\]\.opType/);
  });

  it('parses canonical reconcile response fields', () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:05.000Z',
      changeId: '00000000-0000-0000-0000-000000000005'
    });
    const response = parseApiReconcileResponse({
      clientId: encodeUtf8ToBase64('desktop'),
      cursor,
      lastReconciledWriteIds: { desktop: 5 }
    });

    expect(response).toEqual({
      clientId: 'desktop',
      cursor,
      lastReconciledWriteIds: { desktop: 5 }
    });
  });

  it('rejects legacy stringified reconcile write ids', () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:05.000Z',
      changeId: '00000000-0000-0000-0000-000000000005'
    });

    expect(() =>
      parseApiReconcileResponse({
        clientId: encodeUtf8ToBase64('desktop'),
        cursor,
        lastReconciledWriteIds: { desktop: '5' }
      })
    ).toThrow(/invalid writeId/);
  });
});
