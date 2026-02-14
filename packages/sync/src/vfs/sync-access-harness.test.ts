import { describe, expect, it } from 'vitest';
import { InMemoryVfsAccessHarness } from './sync-access-harness.js';
import type { VfsCrdtSyncItem } from './sync-crdt-feed.js';

function crdtAclAdd(params: {
  opId: string;
  occurredAt: string;
  itemId: string;
  principalType: 'user' | 'group' | 'organization';
  principalId: string;
  accessLevel: 'read' | 'write' | 'admin';
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.itemId,
    opType: 'acl_add',
    principalType: params.principalType,
    principalId: params.principalId,
    accessLevel: params.accessLevel,
    parentId: null,
    childId: null,
    actorId: 'user-1',
    sourceTable: 'vfs_shares',
    sourceId: params.opId,
    occurredAt: params.occurredAt
  };
}

describe('InMemoryVfsAccessHarness', () => {
  it('hydrates CRDT ACL entries with wrapped key material from snapshot rows', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read',
        wrappedSessionKey: 'session-user-2',
        wrappedHierarchicalKey: 'hier-user-2',
        updatedAt: '2026-02-14T03:10:00.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-1',
        occurredAt: '2026-02-14T03:10:05.000Z',
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'write'
      })
    ]);

    expect(harness.buildEffectiveAclKeyView()).toEqual([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'write',
        wrappedSessionKey: 'session-user-2',
        wrappedHierarchicalKey: 'hier-user-2',
        updatedAt: '2026-02-14T03:10:00.000Z'
      }
    ]);
  });

  it('drops snapshot-only ACL entries that are not present in CRDT state', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read',
        wrappedSessionKey: 'session-user-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T03:10:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-3',
        accessLevel: 'read',
        wrappedSessionKey: 'session-user-3',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T03:10:00.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-1',
        occurredAt: '2026-02-14T03:10:05.000Z',
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read'
      })
    ]);

    expect(harness.buildEffectiveAclKeyView()).toEqual([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read',
        wrappedSessionKey: 'session-user-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T03:10:00.000Z'
      }
    ]);
  });

  it('uses CRDT cursor timestamp as fallback updatedAt when snapshot key rows are missing', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-1',
        occurredAt: '2026-02-14T03:10:05.000Z',
        itemId: 'item-1',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'admin'
      })
    ]);

    expect(harness.buildEffectiveAclKeyView()).toEqual([
      {
        itemId: 'item-1',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'admin',
        wrappedSessionKey: null,
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T03:10:05.000Z'
      }
    ]);
  });

  it('preserves strict forward-only page application from CRDT replay layer', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-2',
        occurredAt: '2026-02-14T03:10:06.000Z',
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'write'
      })
    ]);

    expect(() =>
      harness.applyCrdtPage([
        crdtAclAdd({
          opId: 'op-1',
          occurredAt: '2026-02-14T03:10:05.000Z',
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'read'
        })
      ])
    ).toThrowError(/not strictly newer than local cursor/);
  });
});
