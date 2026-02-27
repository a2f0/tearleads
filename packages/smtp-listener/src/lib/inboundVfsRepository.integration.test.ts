import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPglitePool } from '@tearleads/api-test-utils';
import type { Pool as PgPool } from 'pg';
import type {
  InboundMessageEnvelopeRecord,
  ResolvedInboundRecipient
} from '../types/inboundContracts.js';

const { getPostgresPoolMock } = vi.hoisted(() => ({
  getPostgresPoolMock: vi.fn()
}));

vi.mock('./postgres.js', () => ({
  getPostgresPool: getPostgresPoolMock
}));

/**
 * Minimal schema matching the server-side Postgres tables used by
 * inboundVfsRepository. This avoids importing @tearleads/api migrations
 * (which violates the API boundary policy) while still exercising the
 * real SQL queries against an in-memory Postgres via PGlite.
 *
 * Sync triggers are intentionally omitted since they reference auxiliary
 * tables (vfs_sync_changes, vfs_crdt_ops) that are not relevant here.
 */
const SCHEMA_DDL = `
  CREATE TABLE "vfs_registry" (
    "id" TEXT PRIMARY KEY,
    "object_type" TEXT NOT NULL,
    "owner_id" TEXT,
    "encrypted_session_key" TEXT,
    "public_hierarchical_key" TEXT,
    "encrypted_private_hierarchical_key" TEXT,
    "encrypted_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE "emails" (
    "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
    "encrypted_subject" TEXT,
    "encrypted_from" TEXT,
    "encrypted_to" JSONB,
    "encrypted_cc" JSONB,
    "encrypted_body_path" TEXT,
    "ciphertext_size" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_starred" BOOLEAN NOT NULL DEFAULT false
  );

  CREATE TABLE "vfs_links" (
    "id" TEXT PRIMARY KEY,
    "parent_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
    "child_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
    "wrapped_session_key" TEXT NOT NULL,
    "wrapped_hierarchical_key" TEXT,
    "visible_children" JSONB,
    "position" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE "vfs_acl_entries" (
    "id" TEXT PRIMARY KEY,
    "item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
    "principal_type" TEXT NOT NULL CHECK ("principal_type" IN ('user', 'group', 'organization')),
    "principal_id" TEXT NOT NULL,
    "access_level" TEXT NOT NULL CHECK ("access_level" IN ('read', 'write', 'admin')),
    "wrapped_session_key" TEXT,
    "wrapped_hierarchical_key" TEXT,
    "key_epoch" INTEGER,
    "granted_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ
  );
`;

function buildEnvelope(): InboundMessageEnvelopeRecord {
  return {
    messageId: 'msg-1',
    from: { address: 'sender@test.com' },
    to: [{ address: 'user-1@test.com' }],
    receivedAt: '2026-02-23T00:00:00.000Z',
    encryptedSubject: 'enc-subject',
    encryptedFrom: 'enc-from',
    encryptedTo: ['enc-to'],
    encryptedBodyPointer: 'smtp/inbound/msg-1.bin',
    encryptedBodySha256: 'abc123',
    encryptedBodySize: 123,
    wrappedRecipientKeys: [
      {
        userId: 'user-1',
        wrappedDek: 'wrapped-dek',
        keyAlgorithm: 'x25519-mlkem768-v1'
      }
    ]
  };
}

function buildRecipients(): ResolvedInboundRecipient[] {
  return [{ userId: 'user-1', address: 'user-1@test.com' }];
}

describe('PostgresInboundVfsEmailRepository (PGlite integration)', () => {
  let pool: PgPool;
  let exec: (sql: string) => Promise<void>;

  beforeAll(async () => {
    const result = await createPglitePool();
    pool = result.pool;
    exec = result.exec;

    await exec(SCHEMA_DDL);

    getPostgresPoolMock.mockResolvedValue(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE vfs_acl_entries, vfs_links, emails, vfs_registry CASCADE'
    );
  });

  it('persists inbound message with encrypted_name column', async () => {
    const { PostgresInboundVfsEmailRepository } = await import(
      './inboundVfsRepository.js'
    );

    await new PostgresInboundVfsEmailRepository().persistInboundMessage({
      envelope: buildEnvelope(),
      recipients: buildRecipients()
    });

    // Verify inbox folder was created with encrypted_name
    const folderResult = await pool.query(
      `SELECT id, object_type, owner_id, encrypted_name
       FROM vfs_registry WHERE object_type = 'emailFolder'`
    );
    expect(folderResult.rows).toHaveLength(1);
    expect(folderResult.rows[0]).toMatchObject({
      id: 'email-inbox:user-1',
      object_type: 'emailFolder',
      owner_id: 'user-1',
      encrypted_name: 'Inbox'
    });

    // Verify email item was created in vfs_registry
    const emailResult = await pool.query(
      `SELECT id, object_type, owner_id, encrypted_session_key
       FROM vfs_registry WHERE object_type = 'email'`
    );
    expect(emailResult.rows).toHaveLength(1);
    expect(emailResult.rows[0]).toMatchObject({
      object_type: 'email',
      owner_id: 'user-1',
      encrypted_session_key: 'wrapped-dek'
    });

    // Verify email record was created
    const emailsResult = await pool.query(
      `SELECT encrypted_subject, encrypted_from FROM emails`
    );
    expect(emailsResult.rows).toHaveLength(1);
    expect(emailsResult.rows[0]).toMatchObject({
      encrypted_subject: 'enc-subject',
      encrypted_from: 'enc-from'
    });

    // Verify vfs_link was created
    const linksResult = await pool.query(
      `SELECT parent_id, child_id FROM vfs_links`
    );
    expect(linksResult.rows).toHaveLength(1);
    expect(linksResult.rows[0]).toMatchObject({
      parent_id: 'email-inbox:user-1',
      child_id: emailResult.rows[0]!['id']
    });

    // Verify ACL entry was created
    const aclResult = await pool.query(
      `SELECT item_id, principal_id, access_level FROM vfs_acl_entries`
    );
    expect(aclResult.rows).toHaveLength(1);
    expect(aclResult.rows[0]).toMatchObject({
      item_id: emailResult.rows[0]!['id'],
      principal_id: 'user-1',
      access_level: 'read'
    });
  });

  it('upserts inbox folder on duplicate call', async () => {
    const { PostgresInboundVfsEmailRepository } = await import(
      './inboundVfsRepository.js'
    );
    const repo = new PostgresInboundVfsEmailRepository();

    // Persist twice for the same recipient
    await repo.persistInboundMessage({
      envelope: buildEnvelope(),
      recipients: buildRecipients()
    });
    await repo.persistInboundMessage({
      envelope: { ...buildEnvelope(), messageId: 'msg-2' },
      recipients: buildRecipients()
    });

    // Should still have exactly one inbox folder
    const folderResult = await pool.query(
      `SELECT id, encrypted_name FROM vfs_registry WHERE object_type = 'emailFolder'`
    );
    expect(folderResult.rows).toHaveLength(1);
    expect(folderResult.rows[0]).toMatchObject({
      id: 'email-inbox:user-1',
      encrypted_name: 'Inbox'
    });

    // But two email items
    const emailResult = await pool.query(
      `SELECT id FROM vfs_registry WHERE object_type = 'email'`
    );
    expect(emailResult.rows).toHaveLength(2);
  });
});
