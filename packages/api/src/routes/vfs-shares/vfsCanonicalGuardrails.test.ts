import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CANONICAL_SHARE_RUNTIME_PATHS = [
  './get-items-itemId-shares.ts',
  './patch-shares-shareId.ts',
  './delete-shares-shareId.ts',
  './delete-org-shares-shareId.ts',
  './shared.ts'
] as const;

function loadSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('API VFS share canonical guardrails', () => {
  it('share read/auth runtime paths do not reference retired legacy share tables', () => {
    for (const relativePath of CANONICAL_SHARE_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).not.toMatch(/\bvfs_shares\b/u);
      expect(source).not.toMatch(/\borg_shares\b/u);
      expect(source).not.toMatch(/\bvfs_access\b/u);
    }
  });

  it('share read/auth runtime paths keep canonical ACL entry contract', () => {
    const shareReadSource = loadSource('./get-items-itemId-shares.ts');
    const shareAuthSource = loadSource('./shared.ts');

    expect(shareReadSource).toMatch(/\bvfs_acl_entries\b/u);
    expect(shareAuthSource).toMatch(/\bvfs_acl_entries\b/u);
  });
});
