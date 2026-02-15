import { describe, expect, it, vi } from 'vitest';
import {
  buildOrgShareAclId,
  buildShareAclId,
  extractOrgShareIdFromAclId,
  extractShareIdFromAclId,
  extractSourceOrgIdFromOrgShareAclId,
  loadOrgShareAuthorizationContext,
  loadShareAuthorizationContext,
  mapAclAccessLevelToSharePermissionLevel,
  mapSharePermissionLevelToAclAccessLevel,
  parseCreateOrgSharePayload
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

  it('maps read access to view permission', () => {
    expect(mapAclAccessLevelToSharePermissionLevel('read')).toBe('view');
  });

  it('maps write access to edit permission', () => {
    expect(mapAclAccessLevelToSharePermissionLevel('write')).toBe('edit');
  });

  it('maps admin access to edit permission (fail-closed)', () => {
    expect(mapAclAccessLevelToSharePermissionLevel('admin')).toBe('edit');
  });
});

describe('share id helpers', () => {
  it('builds canonical acl ids from normalized id parts', () => {
    expect(buildShareAclId('  share-1  ')).toBe('share:share-1');
    expect(buildOrgShareAclId(' source-org ', ' org-share-1 ')).toBe(
      'org-share:source-org:org-share-1'
    );
  });

  it('extracts share id from share acl id', () => {
    expect(extractShareIdFromAclId('share:abc')).toBe('abc');
  });

  it('extracts org share id and source org from canonical org-share acl id', () => {
    expect(extractOrgShareIdFromAclId('org-share:org-1:abc')).toBe('abc');
    expect(extractSourceOrgIdFromOrgShareAclId('org-share:org-1:abc')).toBe(
      'org-1'
    );
  });

  it('throws on malformed acl id parts', () => {
    expect(() => buildShareAclId('')).toThrow('Unsupported share id');
    expect(() => buildShareAclId('share:1')).toThrow('Unsupported share id');
    expect(() => buildOrgShareAclId('source:org', 'share-1')).toThrow(
      'Unsupported org-share source org id'
    );
    expect(() => extractShareIdFromAclId('share:')).toThrow(
      'Unsupported share id'
    );
    expect(() =>
      extractOrgShareIdFromAclId('org-share:source:share:extra')
    ).toThrow('Unsupported ACL id');
    expect(() => extractOrgShareIdFromAclId('org-share:legacy-only')).toThrow(
      'Unsupported ACL id'
    );
  });
});

describe('org-share payload parsing', () => {
  it('rejects source org ids that cannot be encoded into canonical acl ids', () => {
    expect(
      parseCreateOrgSharePayload({
        itemId: 'item-1',
        sourceOrgId: 'source:org',
        targetOrgId: 'target-org',
        permissionLevel: 'view'
      })
    ).toBeNull();
  });
});

describe('canonical share authorization context', () => {
  it('returns canonical share authorization context when ACL row exists', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          acl_id: 'share:share-1',
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
      aclId: 'share:share-1',
      itemId: 'item-1',
      shareType: 'user',
      targetId: 'user-2',
      accessLevel: 'write'
    });

    const querySql = query.mock.calls[0]?.[0];
    if (typeof querySql !== 'string') {
      throw new Error('expected canonical share auth SQL');
    }
    expect(querySql).toMatch(/\bvfs_acl_entries\b/u);
    expect(querySql).not.toMatch(/\bvfs_shares\b/u);
    expect(querySql).not.toMatch(/\bvfs_access\b/u);
  });

  it('returns null when canonical share ACL row is missing', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(
      loadShareAuthorizationContext({ query }, 'share-1')
    ).resolves.toBeNull();
  });

  it('returns null for malformed route share ids', async () => {
    const query = vi.fn();

    await expect(
      loadShareAuthorizationContext({ query }, 'share:malformed')
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws on unsupported canonical ACL principal types', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          acl_id: 'share:share-1',
          item_id: 'item-1',
          principal_type: 'invalid',
          principal_id: 'user-2',
          access_level: 'read'
        }
      ]
    });

    await expect(
      loadShareAuthorizationContext({ query }, 'share-1')
    ).rejects.toThrow('Unsupported ACL principal type');
  });

  it('throws on unsupported canonical ACL access levels', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          acl_id: 'share:share-1',
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

describe('canonical org-share authorization context', () => {
  it('returns canonical org-share authorization context for encoded source-org format', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          acl_id: 'org-share:source-org:org-share-1',
          item_id: 'item-1',
          principal_id: 'org-2',
          access_level: 'write'
        }
      ]
    });

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org-share-1')
    ).resolves.toEqual({
      ownerId: 'owner-1',
      aclId: 'org-share:source-org:org-share-1',
      itemId: 'item-1',
      targetOrgId: 'org-2',
      accessLevel: 'write',
      sourceOrgId: 'source-org'
    });

    const querySql = query.mock.calls[0]?.[0];
    if (typeof querySql !== 'string') {
      throw new Error('expected canonical org-share auth SQL');
    }
    expect(querySql).toMatch(/\bvfs_acl_entries\b/u);
    expect(querySql).not.toMatch(/\borg_shares\b/u);
    expect(querySql).not.toMatch(/\bvfs_access\b/u);
  });

  it('returns null when canonical org-share ACL row is missing', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org-share-1')
    ).resolves.toBeNull();
  });

  it('returns null for malformed route share ids', async () => {
    const query = vi.fn();

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org:share-1')
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when multiple active ACL rows resolve the same org-share route id', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          acl_id: 'org-share:source-org-a:org-share-1',
          item_id: 'item-1',
          principal_id: 'org-2',
          access_level: 'read'
        },
        {
          owner_id: 'owner-1',
          acl_id: 'org-share:source-org-b:org-share-1',
          item_id: 'item-1',
          principal_id: 'org-2',
          access_level: 'read'
        }
      ]
    });

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org-share-1')
    ).rejects.toThrow('Ambiguous org-share ACL authorization context');
  });

  it('throws on malformed canonical org-share ACL ids', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'owner-1',
          acl_id: 'org-share:source-org:',
          item_id: 'item-1',
          principal_id: 'org-2',
          access_level: 'read'
        }
      ]
    });

    await expect(
      loadOrgShareAuthorizationContext({ query }, 'org-share-1')
    ).rejects.toThrow('Unsupported org-share id');
  });
});
