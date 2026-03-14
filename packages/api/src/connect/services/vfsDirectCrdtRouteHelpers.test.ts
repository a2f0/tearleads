import { describe, expect, it } from 'vitest';
import {
  toIsoString,
  toLastReconciledWriteIds,
  toProtoVfsCrdtSnapshotResponse,
  toProtoVfsCrdtSyncResponse
} from './vfsDirectCrdtRouteHelpers.js';

describe('vfsDirectCrdtRouteHelpers', () => {
  describe('toLastReconciledWriteIds', () => {
    it('returns a deterministic replica clock map sorted by replica id', () => {
      const result = toLastReconciledWriteIds([
        { replica_id: 'replica-b', max_write_id: '7' },
        { replica_id: 'replica-a', max_write_id: 5 }
      ]);

      expect(Object.keys(result)).toEqual(['replica-a', 'replica-b']);
      expect(result).toEqual({
        'replica-a': 5,
        'replica-b': 7
      });
    });

    it('drops malformed rows', () => {
      expect(
        toLastReconciledWriteIds([
          { replica_id: '  ', max_write_id: 4 },
          { replica_id: 'replica-a', max_write_id: 0 },
          { replica_id: 'replica-b', max_write_id: 'nope' },
          { replica_id: null, max_write_id: 2 },
          { replica_id: 'replica-c', max_write_id: 3 }
        ])
      ).toEqual({
        'replica-c': 3
      });
    });
  });

  describe('toIsoString', () => {
    it('serializes Date inputs directly', () => {
      expect(toIsoString(new Date('2026-02-16T00:00:00.000Z'))).toBe(
        '2026-02-16T00:00:00.000Z'
      );
    });

    it('normalizes parseable strings and rejects invalid strings', () => {
      expect(toIsoString('2026-02-16T00:00:00Z')).toBe(
        '2026-02-16T00:00:00.000Z'
      );
      expect(toIsoString('not-a-date')).toBeNull();
    });
  });

  describe('toProtoVfsCrdtSyncResponse', () => {
    it('omits nullable fields and nextCursor when absent', () => {
      const response = toProtoVfsCrdtSyncResponse({
        items: [
          {
            opId: 'op-1',
            itemId: 'item-1',
            opType: 'acl_add',
            principalType: null,
            principalId: null,
            accessLevel: null,
            parentId: null,
            childId: null,
            actorId: null,
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-1',
            occurredAt: '2026-03-07T23:00:00.000Z'
          }
        ],
        nextCursor: null,
        hasMore: false,
        lastReconciledWriteIds: {
          desktop: 7
        }
      });

      expect(response).toEqual({
        items: [
          {
            opId: 'op-1',
            itemId: 'item-1',
            opType: 'acl_add',
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-1',
            occurredAtMs: 1772924400000
          }
        ],
        hasMore: false,
        lastReconciledWriteIds: {
          desktop: 7
        }
      });
    });

    it('preserves populated optional fields and normalized nextCursor', () => {
      const response = toProtoVfsCrdtSyncResponse({
        items: [
          {
            opId: 'op-2',
            itemId: 'item-2',
            opType: 'link_add',
            principalType: 'group',
            principalId: 'group-1',
            accessLevel: 'write',
            parentId: 'parent-1',
            childId: 'item-2',
            actorId: 'user-1',
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-2',
            occurredAt: '2026-03-07T23:00:01.000Z',
            encryptedPayload: 'payload',
            keyEpoch: 4,
            encryptionNonce: 'nonce',
            encryptionAad: 'aad',
            encryptionSignature: 'sig'
          }
        ],
        nextCursor: '  cursor-1  ',
        hasMore: true,
        lastReconciledWriteIds: {
          desktop: 8
        }
      });

      expect(response).toEqual({
        items: [
          {
            opId: 'op-2',
            itemId: 'item-2',
            opType: 'link_add',
            principalType: 'group',
            principalId: 'group-1',
            accessLevel: 'write',
            parentId: 'parent-1',
            childId: 'item-2',
            actorId: 'user-1',
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-2',
            occurredAtMs: 1772924401000,
            encryptedPayload: 'payload',
            keyEpoch: 4,
            encryptionNonce: 'nonce',
            encryptionAad: 'aad',
            encryptionSignature: 'sig'
          }
        ],
        nextCursor: 'cursor-1',
        hasMore: true,
        lastReconciledWriteIds: {
          desktop: 8
        }
      });
    });
  });

  describe('toProtoVfsCrdtSnapshotResponse', () => {
    it('omits optional replay and reconcile cursors when absent', () => {
      const response = toProtoVfsCrdtSnapshotResponse({
        replaySnapshot: {
          acl: [],
          links: [],
          cursor: null
        },
        reconcileState: null,
        containerClocks: [],
        snapshotUpdatedAt: '2026-03-08T00:00:00.000Z'
      });

      expect(response).toEqual({
        replaySnapshot: {
          acl: [],
          links: []
        },
        containerClocks: [],
        snapshotUpdatedAt: '2026-03-08T00:00:00.000Z'
      });
    });

    it('maps populated replay/reconcile cursors and copies write ids', () => {
      const writeIds = {
        desktop: 11
      };

      const response = toProtoVfsCrdtSnapshotResponse({
        replaySnapshot: {
          acl: [
            {
              itemId: 'item-1',
              principalType: 'user',
              principalId: 'user-1',
              accessLevel: 'admin'
            }
          ],
          links: [
            {
              parentId: 'parent-1',
              childId: 'item-1'
            }
          ],
          cursor: {
            changedAt: '2026-03-08T00:00:00.000Z',
            changeId: 'change-10'
          }
        },
        reconcileState: {
          cursor: {
            changedAt: '2026-03-08T00:00:01.000Z',
            changeId: 'change-11'
          },
          lastReconciledWriteIds: writeIds
        },
        containerClocks: [
          {
            containerId: 'item-1',
            changedAt: '2026-03-08T00:00:00.000Z',
            changeId: 'change-10'
          }
        ],
        snapshotUpdatedAt: '2026-03-08T00:00:05.000Z'
      });

      expect(response).toEqual({
        replaySnapshot: {
          acl: [
            {
              itemId: 'item-1',
              principalType: 'user',
              principalId: 'user-1',
              accessLevel: 'admin'
            }
          ],
          links: [
            {
              parentId: 'parent-1',
              childId: 'item-1'
            }
          ],
          cursor: {
            changedAt: '2026-03-08T00:00:00.000Z',
            changeId: 'change-10'
          }
        },
        reconcileState: {
          cursor: {
            changedAt: '2026-03-08T00:00:01.000Z',
            changeId: 'change-11'
          },
          lastReconciledWriteIds: {
            desktop: 11
          }
        },
        containerClocks: [
          {
            containerId: 'item-1',
            changedAt: '2026-03-08T00:00:00.000Z',
            changeId: 'change-10'
          }
        ],
        snapshotUpdatedAt: '2026-03-08T00:00:05.000Z'
      });
      expect(response.reconcileState?.lastReconciledWriteIds).not.toBe(
        writeIds
      );
    });
  });
});
