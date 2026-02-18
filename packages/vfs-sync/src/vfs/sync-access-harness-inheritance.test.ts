import { describe, expect, it } from 'vitest';
import { InMemoryVfsAccessHarness } from './sync-access-harness.js';
import { crdtAclAdd, crdtLinkAdd } from './sync-access-harness-test-support.js';

describe('InMemoryVfsAccessHarness inheritance and catalog guardrails', () => {
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
