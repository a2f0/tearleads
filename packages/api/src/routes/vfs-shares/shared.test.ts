import { describe, expect, it } from 'vitest';
import { mapSharePermissionLevelToAclAccessLevel } from './shared.js';

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
