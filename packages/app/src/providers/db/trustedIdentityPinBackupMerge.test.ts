import { expect, test } from "bun:test";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";
import { mergeTrustedIdentityPinBackupTables } from "./trustedIdentityPinBackupMerge";

const columns = [
  "identity_trust_domain",
  "user_id",
  "format_version",
  "signing_suite",
  "signing_public_key",
  "signing_key_fingerprint",
  "encapsulation_suite",
  "encapsulation_public_key",
  "encapsulation_key_fingerprint",
  "first_seen_at",
] as const;

function row(overrides: Partial<BackupSqlRow> = {}): BackupSqlRow {
  return {
    identity_trust_domain: "https://api.example.test/v1",
    user_id: "11111111-1111-4111-8111-111111111111",
    format_version: 1,
    signing_suite: "ML-DSA-87",
    signing_public_key: "signing-a",
    signing_key_fingerprint: "a".repeat(64),
    encapsulation_suite: "ML-KEM-1024",
    encapsulation_public_key: "kem-a",
    encapsulation_key_fingerprint: "b".repeat(64),
    first_seen_at: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

function table(rows: readonly BackupSqlRow[]): BackupTable {
  return {
    columns,
    name: "trusted_user_identity_pins",
    rows,
    sql: "CREATE TABLE trusted_user_identity_pins (...) ",
  };
}

test("backup restore retains current pins and imports backup-only pins", () => {
  const current = row();
  const restoredCopy = row({ first_seen_at: "2026-07-01T12:00:00.000Z" });
  const restoredOnly = row({
    user_id: "22222222-2222-4222-8222-222222222222",
    signing_public_key: "signing-c",
    signing_key_fingerprint: "c".repeat(64),
    encapsulation_public_key: "kem-d",
    encapsulation_key_fingerprint: "d".repeat(64),
  });

  expect(
    mergeTrustedIdentityPinBackupTables({
      current: table([current]),
      restored: table([restoredCopy, restoredOnly]),
    })?.rows,
  ).toEqual([current, restoredOnly]);
});

test("backup restore rejects a conflicting current identity pin", () => {
  expect(() =>
    mergeTrustedIdentityPinBackupTables({
      current: table([row()]),
      restored: table([row({ encapsulation_public_key: "kem-substituted" })]),
    }),
  ).toThrow("Backup conflicts with a trusted identity pin");
});

test("backup restore rejects binding a pinned signing key to another user", () => {
  // Keyed by user, the merge would otherwise import this as a new pin and
  // leave two users on one signing key within the trust domain.
  const alias = row({ user_id: "22222222-2222-4222-8222-222222222222" });
  expect(() =>
    mergeTrustedIdentityPinBackupTables({
      current: table([row()]),
      restored: table([alias]),
    }),
  ).toThrow("Backup conflicts with a trusted identity pin (user_id)");
  expect(() =>
    mergeTrustedIdentityPinBackupTables({
      current: null,
      restored: table([row(), alias]),
    }),
  ).toThrow("Backup conflicts with a trusted identity pin (user_id)");
});

test("the same signing key may be pinned in another trust domain", () => {
  const otherDomain = row({
    identity_trust_domain: "https://other.example.test/v1",
    user_id: "22222222-2222-4222-8222-222222222222",
  });
  expect(
    mergeTrustedIdentityPinBackupTables({
      current: table([row()]),
      restored: table([otherDomain]),
    })?.rows,
  ).toEqual([row(), otherDomain]);
});

test("backup restore preserves lazy missing trusted identity tables", () => {
  const current = table([row()]);
  const restored = table([
    row({ user_id: "22222222-2222-4222-8222-222222222222" }),
  ]);

  expect(
    mergeTrustedIdentityPinBackupTables({ current, restored: null }),
  ).toEqual(current);
  expect(
    mergeTrustedIdentityPinBackupTables({ current: null, restored }),
  ).toEqual(restored);
  expect(
    mergeTrustedIdentityPinBackupTables({ current: null, restored: null }),
  ).toBeNull();
});

test("backup restore rejects non-current trusted identity rows", () => {
  expect(() =>
    mergeTrustedIdentityPinBackupTables({
      current: null,
      restored: table([row({ format_version: 2 })]),
    }),
  ).toThrow("unsupported format_version");
  expect(() =>
    mergeTrustedIdentityPinBackupTables({
      current: null,
      restored: table([row({ signing_key_fingerprint: "not-a-hash" })]),
    }),
  ).toThrow("invalid signing_key_fingerprint");
});
