import type { Migration, WasmNodeAdapter } from '@tearleads/db-test-utils';
import { vfsTestMigrations } from '@tearleads/db-test-utils';

export const vfsAclEnabledMigrations: Migration[] = [
  ...vfsTestMigrations,
  {
    version: 2,
    up: async (adapter) => {
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_acl_entries (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          principal_type TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          access_level TEXT NOT NULL,
          wrapped_session_key TEXT,
          wrapped_hierarchical_key TEXT,
          granted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER,
          revoked_at INTEGER
        )
      `);
    }
  }
];

export const BOB_ID = 'bob-user-id';
export const BOB_EMAIL = 'bob@example.com';
export const ALICE_ID = 'alice-user-id';
export const ALICE_EMAIL = 'alice@example.com';
export const CAROL_ID = 'carol-user-id';
export const CAROL_EMAIL = 'carol@example.com';

export async function insertUser(
  adapter: WasmNodeAdapter,
  id: string,
  email: string
): Promise<void> {
  await adapter.execute(`INSERT INTO users (id, email) VALUES (?, ?)`, [
    id,
    email
  ]);
}

export async function insertFolder(
  adapter: WasmNodeAdapter,
  id: string,
  name: string,
  ownerId: string,
  createdAt: number
): Promise<void> {
  await adapter.execute(
    `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, 'folder', ownerId, name, createdAt]
  );
}

interface InsertAclOptions {
  id: string;
  itemId: string;
  principalType: string;
  principalId: string;
  accessLevel: string;
  grantedBy: string;
  createdAt: number;
  expiresAt?: number | null;
  revokedAt?: number | null;
}

export async function insertAcl(
  adapter: WasmNodeAdapter,
  opts: InsertAclOptions
): Promise<void> {
  await adapter.execute(
    `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.itemId,
      opts.principalType,
      opts.principalId,
      opts.accessLevel,
      opts.grantedBy,
      opts.createdAt,
      opts.createdAt,
      opts.expiresAt ?? null,
      opts.revokedAt ?? null
    ]
  );
}

export async function seedBobAliceShare(
  adapter: WasmNodeAdapter,
  accessLevel = 'read'
): Promise<string> {
  const now = Date.now();
  const folderId = crypto.randomUUID();

  await insertUser(adapter, BOB_ID, BOB_EMAIL);
  await insertUser(adapter, ALICE_ID, ALICE_EMAIL);
  await insertFolder(adapter, folderId, 'Shared Project', BOB_ID, now);
  await insertAcl(adapter, {
    id: 'share:bob-to-alice',
    itemId: folderId,
    principalType: 'user',
    principalId: ALICE_ID,
    accessLevel,
    grantedBy: BOB_ID,
    createdAt: now
  });

  return folderId;
}
