import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNTIME_ROUTES_ROOT = join(process.cwd(), 'src/routes/vfs');

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

function loadSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('API VFS canonical guardrails', () => {
  it('runtime route sources do not reference retired legacy VFS tables', () => {
    const runtimeFiles = collectRuntimeSourceFiles(RUNTIME_ROUTES_ROOT);

    expect(runtimeFiles.length).toBeGreaterThan(0);

    for (const sourceFile of runtimeFiles) {
      const source = readFileSync(sourceFile, 'utf8');
      expect(source).not.toMatch(/\bvfs_shares\b/u);
      expect(source).not.toMatch(/\borg_shares\b/u);
      expect(source).not.toMatch(/\bvfs_access\b/u);
      expect(source).not.toMatch(/\bvfs_folders\b/u);
      expect(source).not.toMatch(/\bvfs_blob_staging\b/u);
      expect(source).not.toMatch(/\bvfs_blob_refs\b/u);
      expect(source).not.toMatch(/\bvfs_blob_objects\b/u);
    }
  });

  it('CRDT route runtime paths keep canonical table anchors', () => {
    const syncSource = loadSource('./get-crdt-sync.ts');
    const pushSource = loadSource('./post-crdt-push.ts');
    const reconcileSource = loadSource('./post-crdt-reconcile.ts');

    expect(syncSource).toMatch(/\bvfs_crdt_ops\b/u);
    expect(pushSource).toMatch(/\bvfs_crdt_ops\b/u);
    expect(pushSource).toMatch(/\bvfs_registry\b/u);
    expect(reconcileSource).toMatch(/\bvfs_sync_client_state\b/u);
  });
});
