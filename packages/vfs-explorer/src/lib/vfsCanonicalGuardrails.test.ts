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
