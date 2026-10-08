import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

test("SQLite principal key epochs round-trip the safe range and reject overflow", () => {
  const client = new Database(":memory:");
  try {
    migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(
        new URL("../drizzle-sqlite", import.meta.url),
      ),
    });
    // Numeric storage fixtures deliberately do not claim to be signed policies.
    client.exec(`INSERT INTO principal_states (
      id, principal_type, principal_id, version, key_epoch,
      encapsulation_public_key, key_fingerprint, membership_mode, membership_root,
      member_envelopes_root, projection_root, grant_root, payload_ciphertext_hash,
      member_count, grant_count, state_hash, signed_at, signer_user_id,
      signer_user_key_fingerprint, signature
    ) VALUES (
      'state', 'group', 'principal', 1, 1, 'fixture', 'fixture', 'projection',
      'fixture', 'fixture', 'fixture', 'fixture', 'fixture', 1, 0, 'fixture', 0,
      'signer', 'fixture', 'fixture'
    )`);
    client.exec(`INSERT INTO access_manifest_principal_head_projection (
      id, manifest_hash, object_kind, object_id, principal_type, principal_id,
      version, key_epoch, state_hash, key_fingerprint
    ) VALUES ('head', 'fixture', 'container', 'container', 'group', 'principal',
      1, 1, 'fixture', 'fixture')`);
    client.exec(`INSERT INTO principal_epoch_keys (id, principal_type, principal_id, epoch, introduced_by_state_hash, encapsulation_public_key, key_fingerprint)
      VALUES ('key', 'group', 'principal', 1, 'fixture', 'fixture', 'fixture')`);
    client.exec(`INSERT INTO principal_member_envelopes (id, principal_type, principal_id, state_hash, epoch, user_id, member_key_fingerprint, kem_cipher_text, wrapped_key)
      VALUES ('envelope', 'group', 'principal', 'fixture', 1, 'user', 'fixture', 'fixture', 'fixture')`);
    client.exec(`INSERT INTO principal_history_progress (id, principal_type, principal_id, verification_kind, protection_id, input_hash, version, state_hash, key_epoch, key_fingerprint, progress)
      VALUES ('progress', 'group', 'principal', 'policy', 'fixture', 'fixture', 1, 'fixture', 1, 'fixture', 'fixture')`);
    for (const [table, column] of [
      ["principal_states", "key_epoch"],
      ["access_manifest_principal_head_projection", "key_epoch"],
      ["principal_epoch_keys", "epoch"],
      ["principal_member_envelopes", "epoch"],
      ["principal_history_progress", "key_epoch"],
    ]) {
      const update = client.query(`UPDATE ${table} SET ${column} = ?`);
      const read = client.query<{ version: number }, []>(
        `SELECT ${column} AS version FROM ${table}`,
      );
      for (const version of [16_385, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
        update.run(version);
        expect(read.get()?.version).toBe(version);
      }
      for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => update.run(version)).toThrow(`${table}_${column}_range`);
      }
    }
  } finally {
    client.close();
  }
});
