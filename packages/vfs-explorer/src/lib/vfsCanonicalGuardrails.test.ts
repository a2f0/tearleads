import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CANONICAL_FOLDER_RUNTIME_PATHS = [
  '../lib/vfsQuery.ts',
  '../lib/vfsNameLookup.ts',
  '../lib/vfsSharesQuery.ts',
  '../hooks/useVfsFolders.ts',
  '../hooks/useCreateVfsFolder.ts',
  '../hooks/useEnsureVfsRoot.ts',
  '../hooks/useRenameVfsFolder.ts'
] as const;
const CANONICAL_SHARE_RUNTIME_PATHS = ['../lib/vfsSharesQuery.ts'] as const;

function loadSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('VFS canonical folder metadata guardrails', () => {
  it('runtime read/write paths do not reference legacy vfsFolders symbol', () => {
    for (const relativePath of CANONICAL_FOLDER_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).not.toMatch(/\bvfsFolders\b/u);
    }
  });

  it('runtime read/write paths do not import vfsFolders from sqlite schema', () => {
    for (const relativePath of CANONICAL_FOLDER_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).not.toMatch(/import\s*\{[^}]*\bvfsFolders\b[^}]*\}/u);
    }
  });
});

describe('VFS canonical share-query guardrails', () => {
  it('runtime share paths do not reference legacy vfsShares symbol', () => {
    for (const relativePath of CANONICAL_SHARE_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).not.toMatch(/\bvfsShares\b/u);
    }
  });

  it('runtime share paths do not reference legacy orgShares/vfsAccess symbols', () => {
    for (const relativePath of CANONICAL_SHARE_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).not.toMatch(/\borgShares\b/u);
      expect(source).not.toMatch(/\bvfsAccess\b/u);
    }
  });

  it('runtime share paths do not reference retired vfs_shares table', () => {
    for (const relativePath of CANONICAL_SHARE_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).not.toMatch(/\bvfs_shares\b/u);
    }
  });

  it('runtime share paths do not reference retired org_shares/vfs_access tables', () => {
    for (const relativePath of CANONICAL_SHARE_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).not.toMatch(/\borg_shares\b/u);
      expect(source).not.toMatch(/\bvfs_access\b/u);
    }
  });

  it('runtime share paths require canonical vfsAclEntries symbol', () => {
    for (const relativePath of CANONICAL_SHARE_RUNTIME_PATHS) {
      const source = loadSource(relativePath);
      expect(source).toMatch(/\bvfsAclEntries\b/u);
    }
  });
});
