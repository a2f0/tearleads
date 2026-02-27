import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPglitePool } from '@tearleads/api-test-utils';
import { migrations } from '@tearleads/api/migrations';
import { runMigrations } from '@tearleads/db/migrations';
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

    // PGlite compatibility stub for txid_current() used by v021
    await exec(
      `CREATE OR REPLACE FUNCTION txid_current() RETURNS BIGINT
       LANGUAGE SQL AS $$ SELECT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT $$;`
    );

    await runMigrations(pool, migrations);

    getPostgresPoolMock.mockResolvedValue(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean recipient-related tables between tests
    await pool.query(
      'TRUNCATE vfs_acl_entries, vfs_links, emails, vfs_registry, vfs_sync_changes CASCADE'
    );
    await pool.query('DELETE FROM users');
    await pool.query('DELETE FROM organizations');
    // Seed user required by vfs_sync_changes FK trigger
    await pool.query(
      `INSERT INTO organizations (id, name, is_personal, created_at, updated_at)
       VALUES ('org-user-1', 'Personal - user-1', TRUE, NOW(), NOW())`
    );
    await pool.query(
      `INSERT INTO users (id, email, personal_organization_id, created_at, updated_at)
       VALUES ('user-1', 'user-1@test.com', 'org-user-1', NOW(), NOW())`
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
