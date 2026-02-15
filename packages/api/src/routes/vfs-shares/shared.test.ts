import { describe, expect, it, vi } from 'vitest';
import {
  assertItemShareReadParity,
  loadOrgShareAuthorizationContext,
  loadShareAuthorizationContext,
  mapSharePermissionLevelToAclAccessLevel
} from './shared.js';

describe('vfs share acl mapping', () => {
  it('maps view permission to read access', () => {
    expect(mapSharePermissionLevelToAclAccessLevel('view')).toBe('read');
  });

  it('maps edit permission to write access', () => {
    expect(mapSharePermissionLevelToAclAccessLevel('edit')).toBe('write');
  });

  it('maps download permission to read access (fail-closed)', () => {
    expect(mapSharePermissionLevelToAclAccessLevel('download')).toBe('read');
  });
});

describe('share read guardrails', () => {
  it('passes when item-level legacy rows have canonical active ACL parity', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ missing_count: '0' }] });

    await expect(
      assertItemShareReadParity({ query }, 'item-1')
    ).resolves.toBeUndefined();
  });

  it('fails closed when vfs_shares rows are missing canonical parity', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ missing_count: 2 }]
    });

    await expect(
      assertItemShareReadParity({ query }, 'item-1')
    ).rejects.toThrow(
      'vfs_shares rows are missing canonical active ACL parity'
    );
  });

  it('fails closed when org_shares rows are missing canonical parity', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ missing_count: '3' }] });

    await expect(
      assertItemShareReadParity({ query }, 'item-1')
    ).rejects.toThrow(
      'org_shares rows are missing canonical active ACL parity'
    );
  });
});

describe('acl-first share authorization context', () => {
  it('returns canonical share authorization context when ACL row exists', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          item_id: 'item-1',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'write'
        }
      ]
    });

    await expect(
      loadShareAuthorizationContext({ query }, 'share-1')
    ).resolves.toEqual({
      ownerId: 'owner-1',
      itemId: 'item-1',
      shareType: 'user',
      targetId: 'user-2',
      accessLevel: 'write',
      source: 'canonical'
    });
  });

  it('falls back to legacy share rows when canonical ACL row is missing', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'owner-1',
            item_id: 'item-1',
            share_type: 'group',
            target_id: 'group-2',
            permission_level: 'download'
          }
        ]
      });

    await expect(
      loadShareAuthorizationContext({ query }, 'share-1')
    ).resolves.toEqual({
      ownerId: 'owner-1',
      itemId: 'item-1',
      shareType: 'group',
      targetId: 'group-2',
      accessLevel: 'read',
      source: 'legacy'
    });
  });

  it('returns null when neither canonical nor legacy rows exist', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      loadShareAuthorizationContext({ query }, 'share-1')
    ).resolves.toBeNull();
  });

  it('throws on unsupported canonical ACL access levels', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          item_id: 'item-1',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'unknown'
        }
      ]
    });

    await expect(
      loadShareAuthorizationContext({ query }, 'share-1')
    ).rejects.toThrow('Unsupported ACL access level');
  });
});

describe('acl-first org-share authorization context', () => {
  it('returns canonical org-share authorization context when ACL row exists', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          item_id: 'item-1',
          principal_id: 'org-2',
          access_level: 'read'
        }
      ]
    });

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org-share-1')
    ).resolves.toEqual({
      ownerId: 'owner-1',
      itemId: 'item-1',
      targetOrgId: 'org-2',
      accessLevel: 'read',
      source: 'canonical'
    });
  });

  it('falls back to legacy org-share rows when canonical ACL row is missing', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'owner-1',
            item_id: 'item-1',
            target_org_id: 'org-2',
            permission_level: 'edit'
          }
        ]
      });

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org-share-1')
    ).resolves.toEqual({
      ownerId: 'owner-1',
      itemId: 'item-1',
      targetOrgId: 'org-2',
      accessLevel: 'write',
      source: 'legacy'
    });
  });

  it('returns null when neither canonical nor legacy org-share rows exist', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org-share-1')
    ).resolves.toBeNull();
  });
});
