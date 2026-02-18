import { describe, expect, it } from 'vitest';
import { InMemoryVfsAccessHarness } from './sync-access-harness.js';
import { crdtAclAdd } from './sync-access-harness-test-support.js';

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
});
