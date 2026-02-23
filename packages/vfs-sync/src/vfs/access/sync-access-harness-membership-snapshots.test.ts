import { describe, expect, it } from 'vitest';
import { InMemoryVfsAccessHarness } from './sync-access-harness.js';
import { crdtAclAdd } from './sync-access-harness-test-support.js';

describe('InMemoryVfsAccessHarness membership snapshots', () => {
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
});
