import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v034 migration', () => {
  it('adds bytea envelope columns and backfills decodable text rows', async () => {
    const pool = createMockPool(new Map());

    const v034 = migrations.find(
      (migration: Migration) => migration.version === 34
    );
    if (!v034) {
      throw new Error('v034 migration not found');
    }

    await v034.up(pool);

    const queries = pool.queries.join('\n');

    expect(queries).toContain(
      'ADD COLUMN IF NOT EXISTS "encrypted_payload_bytes" BYTEA'
    );
    expect(queries).toContain(
      'ADD COLUMN IF NOT EXISTS "encryption_nonce_bytes" BYTEA'
    );
    expect(queries).toContain(
      'ADD COLUMN IF NOT EXISTS "encryption_aad_bytes" BYTEA'
    );
    expect(queries).toContain(
      'ADD COLUMN IF NOT EXISTS "encryption_signature_bytes" BYTEA'
    );

    expect(queries).toContain(
      "SET encrypted_payload_bytes = decode(encrypted_payload, 'base64')"
    );
    expect(queries).toContain(
      "SET encryption_nonce_bytes = decode(encryption_nonce, 'base64')"
    );
    expect(queries).toContain(
      "SET encryption_aad_bytes = decode(encryption_aad, 'base64')"
    );
    expect(queries).toContain(
      "SET encryption_signature_bytes = decode(encryption_signature, 'base64')"
    );
  });
});
