import { describe, expect, it } from 'vitest';
import { buildVfsAclKeyView } from './acl-key-view.js';

describe('buildVfsAclKeyView', () => {
  it('filters revoked and expired entries', () => {
    const view = buildVfsAclKeyView(
      [
        {
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-a',
          accessLevel: 'read',
          wrappedSessionKey: 's1',
          wrappedHierarchicalKey: null,
          updatedAt: '2025-02-01T00:00:00.000Z',
          revokedAt: null,
          expiresAt: null
        },
        {
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-b',
          accessLevel: 'write',
          wrappedSessionKey: 's2',
          wrappedHierarchicalKey: null,
          updatedAt: '2025-02-01T00:00:00.000Z',
          revokedAt: '2025-02-01T00:00:01.000Z',
          expiresAt: null
        },
        {
          itemId: 'item-1',
          principalType: 'group',
          principalId: 'group-a',
          accessLevel: 'admin',
          wrappedSessionKey: 's3',
          wrappedHierarchicalKey: 'h3',
          updatedAt: '2025-02-01T00:00:00.000Z',
          revokedAt: null,
          expiresAt: '2025-01-01T00:00:00.000Z'
        }
      ],
      new Date('2025-02-10T00:00:00.000Z')
    );

    expect(view).toEqual([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-a',
        accessLevel: 'read',
        wrappedSessionKey: 's1',
        wrappedHierarchicalKey: null,
        updatedAt: '2025-02-01T00:00:00.000Z'
      }
    ]);
  });

  it('keeps newest entry and coalesces missing key fields', () => {
    const view = buildVfsAclKeyView(
      [
        {
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-a',
          accessLevel: 'read',
          wrappedSessionKey: 'session-old',
          wrappedHierarchicalKey: 'hier-old',
          updatedAt: '2025-02-01T00:00:00.000Z',
          revokedAt: null,
          expiresAt: null
        },
        {
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-a',
          accessLevel: 'write',
          wrappedSessionKey: null,
          wrappedHierarchicalKey: 'hier-new',
          updatedAt: '2025-02-01T00:00:01.000Z',
          revokedAt: null,
          expiresAt: null
        }
      ],
      new Date('2025-02-10T00:00:00.000Z')
    );

    expect(view).toEqual([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'user-a',
        accessLevel: 'write',
        wrappedSessionKey: 'session-old',
        wrappedHierarchicalKey: 'hier-new',
        updatedAt: '2025-02-01T00:00:01.000Z'
      }
    ]);
  });
});
