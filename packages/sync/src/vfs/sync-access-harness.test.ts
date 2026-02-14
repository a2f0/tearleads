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

function crdtLinkAdd(params: {
  opId: string;
  occurredAt: string;
  itemId: string;
  parentId: string;
  childId: string;
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.itemId,
    opType: 'link_add',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: params.parentId,
    childId: params.childId,
    actorId: 'user-1',
    sourceTable: 'vfs_links',
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

  it('resolves deterministic per-item member access across user/group/org principals', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-1',
        accessLevel: 'read',
        wrappedSessionKey: 'session-user-1',
        wrappedHierarchicalKey: 'hier-user-1',
        updatedAt: '2026-02-14T04:00:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-1',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write',
        wrappedSessionKey: 'session-group-1',
        wrappedHierarchicalKey: 'hier-group-1',
        updatedAt: '2026-02-14T04:00:01.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-1',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin',
        wrappedSessionKey: 'session-org-1',
        wrappedHierarchicalKey: 'hier-org-1',
        updatedAt: '2026-02-14T04:00:02.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-2',
        principalType: 'user',
        principalId: 'user-1',
        accessLevel: 'read',
        wrappedSessionKey: 'session-user-1-item-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T04:01:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-2',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read',
        wrappedSessionKey: 'session-group-1-item-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T04:01:01.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-1',
        occurredAt: '2026-02-14T04:10:00.000Z',
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-1',
        accessLevel: 'read'
      }),
      crdtAclAdd({
        opId: 'op-2',
        occurredAt: '2026-02-14T04:10:01.000Z',
        itemId: 'item-1',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }),
      crdtAclAdd({
        opId: 'op-3',
        occurredAt: '2026-02-14T04:10:02.000Z',
        itemId: 'item-1',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin'
      }),
      crdtAclAdd({
        opId: 'op-4',
        occurredAt: '2026-02-14T04:10:03.000Z',
        itemId: 'item-2',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }),
      crdtAclAdd({
        opId: 'op-5',
        occurredAt: '2026-02-14T04:10:04.000Z',
        itemId: 'item-2',
        principalType: 'user',
        principalId: 'user-1',
        accessLevel: 'read'
      })
    ]);

    expect(
      harness.buildEffectiveAccessForMember({
        userId: 'user-1',
        groupIds: ['group-1'],
        organizationIds: ['org-1']
      })
    ).toEqual([
      {
        itemId: 'item-1',
        accessLevel: 'admin',
        principalType: 'organization',
        principalId: 'org-1',
        wrappedSessionKey: 'session-org-1',
        wrappedHierarchicalKey: 'hier-org-1',
        updatedAt: '2026-02-14T04:00:02.000Z'
      },
      {
        itemId: 'item-2',
        accessLevel: 'read',
        principalType: 'user',
        principalId: 'user-1',
        wrappedSessionKey: 'session-user-1-item-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T04:01:00.000Z'
      }
    ]);
  });

  it('uses updatedAt then lexical principal tiebreakers for equal rank principals', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'item-3',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write',
        wrappedSessionKey: 'session-group-1',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T05:00:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-3',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write',
        wrappedSessionKey: 'session-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T05:00:01.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-4',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write',
        wrappedSessionKey: 'session-item-4-group-1',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T05:01:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-4',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write',
        wrappedSessionKey: 'session-item-4-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T05:01:00.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-10',
        occurredAt: '2026-02-14T05:10:00.000Z',
        itemId: 'item-3',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }),
      crdtAclAdd({
        opId: 'op-11',
        occurredAt: '2026-02-14T05:10:01.000Z',
        itemId: 'item-3',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write'
      }),
      crdtAclAdd({
        opId: 'op-12',
        occurredAt: '2026-02-14T05:10:02.000Z',
        itemId: 'item-4',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }),
      crdtAclAdd({
        opId: 'op-13',
        occurredAt: '2026-02-14T05:10:03.000Z',
        itemId: 'item-4',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write'
      })
    ]);

    expect(
      harness.buildEffectiveAccessForMember({
        userId: 'user-9',
        groupIds: ['group-1', 'group-2'],
        organizationIds: []
      })
    ).toEqual([
      {
        itemId: 'item-3',
        accessLevel: 'write',
        principalType: 'group',
        principalId: 'group-2',
        wrappedSessionKey: 'session-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T05:00:01.000Z'
      },
      {
        itemId: 'item-4',
        accessLevel: 'write',
        principalType: 'group',
        principalId: 'group-2',
        wrappedSessionKey: 'session-item-4-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T05:01:00.000Z'
      }
    ]);
  });

  it('maps authoritative membership snapshots into user access resolution', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'item-10',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write',
        wrappedSessionKey: 'session-group-1',
        wrappedHierarchicalKey: 'hier-group-1',
        updatedAt: '2026-02-14T06:00:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-10',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin',
        wrappedSessionKey: 'session-org-1',
        wrappedHierarchicalKey: 'hier-org-1',
        updatedAt: '2026-02-14T06:00:01.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-100',
        occurredAt: '2026-02-14T06:10:00.000Z',
        itemId: 'item-10',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }),
      crdtAclAdd({
        opId: 'op-101',
        occurredAt: '2026-02-14T06:10:01.000Z',
        itemId: 'item-10',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin'
      })
    ]);

    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T06:20:00.000Z',
        changeId: 'membership-1'
      },
      members: [
        {
          userId: 'user-1',
          groupIds: ['group-1'],
          organizationIds: ['org-1']
        }
      ]
    });

    expect(harness.getMembershipSnapshotCursor()).toEqual({
      changedAt: '2026-02-14T06:20:00.000Z',
      changeId: 'membership-1'
    });

    expect(harness.buildEffectiveAccessForUser('user-1')).toEqual([
      {
        itemId: 'item-10',
        accessLevel: 'admin',
        principalType: 'organization',
        principalId: 'org-1',
        wrappedSessionKey: 'session-org-1',
        wrappedHierarchicalKey: 'hier-org-1',
        updatedAt: '2026-02-14T06:00:01.000Z'
      }
    ]);
  });

  it('applies membership churn when newer authoritative snapshots remove grants', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'item-20',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write',
        wrappedSessionKey: 'session-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T07:00:00.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-200',
        occurredAt: '2026-02-14T07:10:00.000Z',
        itemId: 'item-20',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write'
      })
    ]);

    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T07:20:00.000Z',
        changeId: 'membership-2'
      },
      members: [
        {
          userId: 'user-2',
          groupIds: ['group-2'],
          organizationIds: []
        }
      ]
    });

    expect(harness.buildEffectiveAccessForUser('user-2')).toEqual([
      {
        itemId: 'item-20',
        accessLevel: 'write',
        principalType: 'group',
        principalId: 'group-2',
        wrappedSessionKey: 'session-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T07:00:00.000Z'
      }
    ]);

    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T07:21:00.000Z',
        changeId: 'membership-3'
      },
      members: [
        {
          userId: 'user-2',
          groupIds: [],
          organizationIds: []
        }
      ]
    });

    expect(harness.buildEffectiveAccessForUser('user-2')).toEqual([]);
  });

  it('rejects stale membership snapshots and prevents stale cache privilege rollback', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'item-30',
        principalType: 'group',
        principalId: 'group-3',
        accessLevel: 'admin',
        wrappedSessionKey: 'session-group-3',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T08:00:00.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-300',
        occurredAt: '2026-02-14T08:10:00.000Z',
        itemId: 'item-30',
        principalType: 'group',
        principalId: 'group-3',
        accessLevel: 'admin'
      })
    ]);

    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T08:20:00.000Z',
        changeId: 'membership-4'
      },
      members: [
        {
          userId: 'user-3',
          groupIds: [],
          organizationIds: []
        }
      ]
    });

    expect(() =>
      harness.replaceMembershipSnapshot({
        cursor: {
          changedAt: '2026-02-14T08:19:59.000Z',
          changeId: 'membership-stale'
        },
        members: [
          {
            userId: 'user-3',
            groupIds: ['group-3'],
            organizationIds: []
          }
        ]
      })
    ).toThrowError(/membership snapshot cursor regressed/);

    expect(harness.getMembershipSnapshotCursor()).toEqual({
      changedAt: '2026-02-14T08:20:00.000Z',
      changeId: 'membership-4'
    });
    expect(harness.buildEffectiveAccessForUser('user-3')).toEqual([]);
  });

  it('applies subtree boundary override semantics for inherited access', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'root-item',
        principalType: 'organization',
        principalId: 'org-9',
        accessLevel: 'admin',
        wrappedSessionKey: 'session-org-9',
        wrappedHierarchicalKey: 'hier-org-9',
        updatedAt: '2026-02-14T09:30:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'child-item',
        principalType: 'user',
        principalId: 'user-9',
        accessLevel: 'read',
        wrappedSessionKey: 'session-user-9',
        wrappedHierarchicalKey: 'hier-user-9',
        updatedAt: '2026-02-14T09:30:01.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-400',
        occurredAt: '2026-02-14T09:31:00.000Z',
        itemId: 'root-item',
        principalType: 'organization',
        principalId: 'org-9',
        accessLevel: 'admin'
      }),
      crdtAclAdd({
        opId: 'op-401',
        occurredAt: '2026-02-14T09:31:01.000Z',
        itemId: 'child-item',
        principalType: 'user',
        principalId: 'user-9',
        accessLevel: 'read'
      }),
      crdtLinkAdd({
        opId: 'op-402',
        occurredAt: '2026-02-14T09:31:02.000Z',
        itemId: 'child-item',
        parentId: 'root-item',
        childId: 'child-item'
      }),
      crdtLinkAdd({
        opId: 'op-403',
        occurredAt: '2026-02-14T09:31:03.000Z',
        itemId: 'leaf-item',
        parentId: 'child-item',
        childId: 'leaf-item'
      })
    ]);

    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T09:40:00.000Z',
        changeId: 'membership-inherit-1'
      },
      members: [
        {
          userId: 'user-9',
          groupIds: [],
          organizationIds: ['org-9']
        }
      ]
    });

    expect(
      harness.buildEffectiveAccessForUserWithInheritance('user-9')
    ).toEqual([
      {
        itemId: 'child-item',
        accessLevel: 'read',
        principalType: 'user',
        principalId: 'user-9',
        wrappedSessionKey: 'session-user-9',
        wrappedHierarchicalKey: 'hier-user-9',
        updatedAt: '2026-02-14T09:30:01.000Z'
      },
      {
        itemId: 'leaf-item',
        accessLevel: 'read',
        principalType: 'user',
        principalId: 'user-9',
        wrappedSessionKey: 'session-user-9',
        wrappedHierarchicalKey: 'hier-user-9',
        updatedAt: '2026-02-14T09:30:01.000Z'
      },
      {
        itemId: 'root-item',
        accessLevel: 'admin',
        principalType: 'organization',
        principalId: 'org-9',
        wrappedSessionKey: 'session-org-9',
        wrappedHierarchicalKey: 'hier-org-9',
        updatedAt: '2026-02-14T09:30:00.000Z'
      }
    ]);
  });

  it('fails closed for multi-parent inheritance to avoid privilege escalation', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'open-parent',
        principalType: 'group',
        principalId: 'group-7',
        accessLevel: 'write',
        wrappedSessionKey: 'session-group-7',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T10:00:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'restricted-parent',
        principalType: 'organization',
        principalId: 'org-restricted',
        accessLevel: 'admin',
        wrappedSessionKey: 'session-org-restricted',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T10:00:01.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-500',
        occurredAt: '2026-02-14T10:01:00.000Z',
        itemId: 'open-parent',
        principalType: 'group',
        principalId: 'group-7',
        accessLevel: 'write'
      }),
      crdtAclAdd({
        opId: 'op-501',
        occurredAt: '2026-02-14T10:01:01.000Z',
        itemId: 'restricted-parent',
        principalType: 'organization',
        principalId: 'org-restricted',
        accessLevel: 'admin'
      }),
      crdtLinkAdd({
        opId: 'op-502',
        occurredAt: '2026-02-14T10:01:02.000Z',
        itemId: 'shared-child',
        parentId: 'open-parent',
        childId: 'shared-child'
      }),
      crdtLinkAdd({
        opId: 'op-503',
        occurredAt: '2026-02-14T10:01:03.000Z',
        itemId: 'shared-child',
        parentId: 'restricted-parent',
        childId: 'shared-child'
      })
    ]);

    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T10:10:00.000Z',
        changeId: 'membership-inherit-2'
      },
      members: [
        {
          userId: 'user-7',
          groupIds: ['group-7'],
          organizationIds: []
        }
      ]
    });

    expect(
      harness.buildEffectiveAccessForUserWithInheritance('user-7')
    ).toEqual([
      {
        itemId: 'open-parent',
        accessLevel: 'write',
        principalType: 'group',
        principalId: 'group-7',
        wrappedSessionKey: 'session-group-7',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T10:00:00.000Z'
      }
    ]);
  });

  it('filters deleted principals with authoritative catalog snapshots and rejects stale rollback', () => {
    const harness = new InMemoryVfsAccessHarness();

    harness.setAclSnapshotEntries([
      {
        itemId: 'group-item',
        principalType: 'group',
        principalId: 'group-deleted',
        accessLevel: 'write',
        wrappedSessionKey: 'session-group-deleted',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T11:00:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'org-item',
        principalType: 'organization',
        principalId: 'org-live',
        accessLevel: 'admin',
        wrappedSessionKey: 'session-org-live',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T11:00:01.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);

    harness.applyCrdtPage([
      crdtAclAdd({
        opId: 'op-600',
        occurredAt: '2026-02-14T11:01:00.000Z',
        itemId: 'group-item',
        principalType: 'group',
        principalId: 'group-deleted',
        accessLevel: 'write'
      }),
      crdtAclAdd({
        opId: 'op-601',
        occurredAt: '2026-02-14T11:01:01.000Z',
        itemId: 'org-item',
        principalType: 'organization',
        principalId: 'org-live',
        accessLevel: 'admin'
      })
    ]);

    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T11:05:00.000Z',
        changeId: 'membership-catalog-1'
      },
      members: [
        {
          userId: 'user-33',
          groupIds: ['group-deleted'],
          organizationIds: ['org-live']
        }
      ]
    });

    harness.replacePrincipalCatalogSnapshot({
      cursor: {
        changedAt: '2026-02-14T11:05:01.000Z',
        changeId: 'catalog-1'
      },
      groupIds: ['group-deleted'],
      organizationIds: ['org-live']
    });

    expect(harness.buildEffectiveAccessForUser('user-33')).toEqual([
      {
        itemId: 'group-item',
        accessLevel: 'write',
        principalType: 'group',
        principalId: 'group-deleted',
        wrappedSessionKey: 'session-group-deleted',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T11:00:00.000Z'
      },
      {
        itemId: 'org-item',
        accessLevel: 'admin',
        principalType: 'organization',
        principalId: 'org-live',
        wrappedSessionKey: 'session-org-live',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T11:00:01.000Z'
      }
    ]);

    harness.replacePrincipalCatalogSnapshot({
      cursor: {
        changedAt: '2026-02-14T11:06:00.000Z',
        changeId: 'catalog-2'
      },
      groupIds: [],
      organizationIds: ['org-live']
    });

    expect(harness.buildEffectiveAccessForUser('user-33')).toEqual([
      {
        itemId: 'org-item',
        accessLevel: 'admin',
        principalType: 'organization',
        principalId: 'org-live',
        wrappedSessionKey: 'session-org-live',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T11:00:01.000Z'
      }
    ]);

    expect(() =>
      harness.replacePrincipalCatalogSnapshot({
        cursor: {
          changedAt: '2026-02-14T11:05:59.000Z',
          changeId: 'catalog-stale'
        },
        groupIds: ['group-deleted'],
        organizationIds: ['org-live']
      })
    ).toThrowError(/principal catalog snapshot cursor regressed/);

    expect(harness.getPrincipalCatalogCursor()).toEqual({
      changedAt: '2026-02-14T11:06:00.000Z',
      changeId: 'catalog-2'
    });
    expect(harness.buildEffectiveAccessForUser('user-33')).toEqual([
      {
        itemId: 'org-item',
        accessLevel: 'admin',
        principalType: 'organization',
        principalId: 'org-live',
        wrappedSessionKey: 'session-org-live',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T11:00:01.000Z'
      }
    ]);
  });
});
