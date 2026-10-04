import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

test("SQLite principal versions round-trip the safe range and reject overflow", () => {
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
    for (const table of [
      "principal_states",
      "access_manifest_principal_head_projection",
    ]) {
      const update = client.query(`UPDATE ${table} SET version = ?`);
      const read = client.query<{ version: number }, []>(
        `SELECT version FROM ${table}`,
      );
      for (const version of [16_385, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
        update.run(version);
        expect(read.get()?.version).toBe(version);
      }
      for (const version of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => update.run(version)).toThrow(`${table}_version_range`);
      }
    }
  } finally {
    client.close();
  }
});
