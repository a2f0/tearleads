import { describe, expect, it } from 'vitest';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  parseApiPullResponse,
  parseApiPushResponse,
  parseApiReconcileResponse
} from './sync-http-transport-parser';

function createEncryptedItem(keyEpoch: number): Record<string, unknown> {
  return {
    opId: 'op-1',
    itemId: 'item-1',
    opType: 'acl_add',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: null,
    childId: null,
    actorId: 'user-1',
    sourceTable: 'vfs_acl_entries',
    sourceId: 'row-1',
    occurredAt: new Date('2026-02-21T10:00:00.000Z').toISOString(),
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
          opId: 'op-2',
          itemId: 'item-2',
          opType: 'item_upsert',
          principalType: '',
          principalId: '',
          accessLevel: '',
          parentId: '',
          childId: '',
          actorId: '',
          sourceTable: 'vfs_item_state',
          sourceId: 'row-2',
          occurredAt: new Date('2026-02-21T10:00:01.000Z').toISOString()
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

  it('parses compact push response fields', () => {
    const response = parseApiPushResponse({
      clientIdBytes: encodeUtf8ToBase64('desktop'),
      results: [
        {
          opIdBytes: encodeUtf8ToBase64('desktop-1'),
          statusEnum: 'VFS_CRDT_PUSH_STATUS_APPLIED'
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

  it('parses compact pull item fields', () => {
    const response = parseApiPullResponse({
      items: [
        {
          opIdBytes: encodeUtf8ToBase64('desktop-2'),
          itemIdBytes: encodeUtf8ToBase64('item-2'),
          opTypeEnum: 5,
          principalTypeEnum: 2,
          principalIdBytes: encodeUtf8ToBase64('group-1'),
          accessLevelEnum: 2,
          actorIdBytes: encodeUtf8ToBase64('user-1'),
          sourceTable: 'vfs_crdt_client_push',
          sourceIdBytes: encodeUtf8ToBase64('source-row-2'),
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

  it('parses compact reconcile response fields', () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:05.000Z',
      changeId: 'desktop-5'
    });
    const response = parseApiReconcileResponse({
      clientIdBytes: encodeUtf8ToBase64('desktop'),
      cursor,
      lastReconciledWriteIds: { desktop: 5 }
    });

    expect(response).toEqual({
      clientId: 'desktop',
      cursor,
      lastReconciledWriteIds: { desktop: 5 }
    });
  });
});
