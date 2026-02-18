import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNTIME_ROUTES_ROOT = join(process.cwd(), 'src/routes/vfs-shares');

function collectRuntimeSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectRuntimeSourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    if (entry.name.endsWith('.test.ts')) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

describe('API VFS share canonical guardrails', () => {
  it('share read/auth runtime paths do not reference retired legacy share tables', () => {
    const runtimeFiles = collectRuntimeSourceFiles(RUNTIME_ROUTES_ROOT);

    expect(runtimeFiles.length).toBeGreaterThan(0);

    for (const sourceFile of runtimeFiles) {
      const source = readFileSync(sourceFile, 'utf8');
      expect(source).not.toMatch(/\bvfs_shares\b/u);
      expect(source).not.toMatch(/\borg_shares\b/u);
      expect(source).not.toMatch(/\bvfs_access\b/u);
    }
  });

  it('share read/auth runtime paths keep canonical ACL entry contract', () => {
    const runtimeFiles = collectRuntimeSourceFiles(RUNTIME_ROUTES_ROOT);
    const combinedSource = runtimeFiles
      .map((sourceFile) => readFileSync(sourceFile, 'utf8'))
      .join('\n');

    expect(combinedSource).toMatch(/\bvfs_acl_entries\b/u);
  });
});
