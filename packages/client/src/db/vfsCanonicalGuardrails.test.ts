import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_SRC_ROOT = join(process.cwd(), 'src');

function collectRuntimeSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'migrations' || entry.name === '__tests__') {
        continue;
      }
      files.push(...collectRuntimeSourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const isTypeScriptFile =
      entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');
    const isTestFile =
      entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx');

    if (!isTypeScriptFile || isTestFile) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

describe('client VFS canonical guardrails', () => {
  it('runtime source excludes legacy VFS table references', () => {
    const runtimeSourceFiles = collectRuntimeSourceFiles(CLIENT_SRC_ROOT);

    expect(runtimeSourceFiles.length).toBeGreaterThan(0);

    for (const sourceFile of runtimeSourceFiles) {
      const source = readFileSync(sourceFile, 'utf8');
      expect(source).not.toMatch(/\bvfsFolders\b/u);
      expect(source).not.toMatch(/\bvfsShares\b/u);
      expect(source).not.toMatch(/\borgShares\b/u);
      expect(source).not.toMatch(/\bvfsAccess\b/u);
      expect(source).not.toContain('vfs_folders');
      expect(source).not.toMatch(/\bvfs_shares\b/u);
      expect(source).not.toMatch(/\borg_shares\b/u);
      expect(source).not.toMatch(/\bvfs_access\b/u);
    }
  });
});
