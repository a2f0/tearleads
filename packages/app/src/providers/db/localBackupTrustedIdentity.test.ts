import { expect, test } from "bun:test";
import type {
  BlobByteSource,
  BlobBytes,
  BlobStore,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";

const TRUST_DOMAIN = "https://api.example.test/v1";
const CURRENT_USER_ID = "11111111-1111-4111-8111-111111111111";
const BACKUP_ONLY_USER_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_FIRST_SEEN = "2026-07-15T12:00:00.000Z";
const BACKUP_FIRST_SEEN = "2026-07-01T12:00:00.000Z";

interface IdentityPin {
  readonly encapsulationKeyFingerprint: string;
  readonly encapsulationPublicKey: string;
  readonly encapsulationSuite: string;
  readonly firstSeenAt: string;
  readonly formatVersion: number;
  readonly identityTrustDomain: string;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: string;
  readonly signingSuite: string;
  readonly userId: string;
}

class EmptyBlobStore implements BlobStore {
  async deleteBytes(_storageKey: string): Promise<void> {}

  async readBytes(_storageKey: string): Promise<BlobBytes | null> {
    return null;
  }

  async openByteSource(_storageKey: string): Promise<BlobByteSource | null> {
    return null;
  }

  async writeByteSource(
    _storageKey: string,
    _source: BlobByteSource,
  ): Promise<void> {}

  async writeBytes(_storageKey: string, _bytes: BlobBytes): Promise<void> {}
}

function identityPin(overrides: Partial<IdentityPin> = {}): IdentityPin {
  return {
    encapsulationKeyFingerprint: "b".repeat(64),
    encapsulationPublicKey: "encapsulation-public-key-a",
    encapsulationSuite: "ML-KEM-1024",
    firstSeenAt: BACKUP_FIRST_SEEN,
    formatVersion: 1,
    identityTrustDomain: TRUST_DOMAIN,
    signingKeyFingerprint: "a".repeat(64),
    signingPublicKey: "signing-public-key-a",
    signingSuite: "ML-DSA-87",
    userId: CURRENT_USER_ID,
    ...overrides,
  };
}

async function createIdentityPinTable(execSql: ExecSql): Promise<void> {
  await execSql(`
    CREATE TABLE trusted_user_identity_pins (
      identity_trust_domain TEXT NOT NULL,
      user_id TEXT NOT NULL,
      format_version INTEGER NOT NULL,
      signing_suite TEXT NOT NULL,
      signing_public_key TEXT NOT NULL,
      signing_key_fingerprint TEXT NOT NULL,
      encapsulation_suite TEXT NOT NULL,
      encapsulation_public_key TEXT NOT NULL,
      encapsulation_key_fingerprint TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (identity_trust_domain, user_id)
    )
  `);
}

async function insertIdentityPin(
  execSql: ExecSql,
  pin: IdentityPin,
): Promise<void> {
  await execSql(
    `INSERT INTO trusted_user_identity_pins (
       identity_trust_domain,
       user_id,
       format_version,
       signing_suite,
       signing_public_key,
       signing_key_fingerprint,
       encapsulation_suite,
       encapsulation_public_key,
       encapsulation_key_fingerprint,
       first_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pin.identityTrustDomain,
      pin.userId,
      pin.formatVersion,
      pin.signingSuite,
      pin.signingPublicKey,
      pin.signingKeyFingerprint,
      pin.encapsulationSuite,
      pin.encapsulationPublicKey,
      pin.encapsulationKeyFingerprint,
      pin.firstSeenAt,
    ],
  );
}

async function createPayload(execSql: ExecSql) {
  return createBackupPayload({
    blobStore: new EmptyBlobStore(),
    databaseId: "backup-source",
    execSql,
    signingFingerprint: null,
  });
}

test("real backup restore preserves current first-seen time and imports backup-only pins", async () => {
  const source = await createTestExecSql("backup-identity-merge-source");
  const target = await createTestExecSql("backup-identity-merge-target");
  try {
    await createIdentityPinTable(source.execSql);
    await insertIdentityPin(source.execSql, identityPin());
    await insertIdentityPin(
      source.execSql,
      identityPin({
        firstSeenAt: "2026-07-10T12:00:00.000Z",
        userId: BACKUP_ONLY_USER_ID,
      }),
    );
    const payload = await createPayload(source.execSql);

    await createIdentityPinTable(target.execSql);
    await insertIdentityPin(
      target.execSql,
      identityPin({ firstSeenAt: CURRENT_FIRST_SEEN }),
    );
    await restoreBackupPayload({
      blobStore: new EmptyBlobStore(),
      execSql: target.execSql,
      payload,
    });

    await expect(
      target.execSql(
        `SELECT user_id, first_seen_at
         FROM trusted_user_identity_pins
         ORDER BY user_id`,
      ),
    ).resolves.toEqual([
      { first_seen_at: CURRENT_FIRST_SEEN, user_id: CURRENT_USER_ID },
      {
        first_seen_at: "2026-07-10T12:00:00.000Z",
        user_id: BACKUP_ONLY_USER_ID,
      },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

test("conflicting backup pin rolls back before replacing target tables", async () => {
  const source = await createTestExecSql("backup-identity-conflict-source");
  const target = await createTestExecSql("backup-identity-conflict-target");
  const targetPin = identityPin({ firstSeenAt: CURRENT_FIRST_SEEN });
  try {
    await createIdentityPinTable(source.execSql);
    await insertIdentityPin(
      source.execSql,
      identityPin({ signingPublicKey: "substituted-signing-key" }),
    );
    const payload = await createPayload(source.execSql);

    await createIdentityPinTable(target.execSql);
    await insertIdentityPin(target.execSql, targetPin);
    await target.execSql(`
      CREATE TABLE local_only_records (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await target.execSql(
      "INSERT INTO local_only_records (id, value) VALUES (?, ?)",
      ["local-1", "must survive"],
    );

    await expect(
      restoreBackupPayload({
        blobStore: new EmptyBlobStore(),
        execSql: target.execSql,
        payload,
      }),
    ).rejects.toThrow("Backup conflicts with a trusted identity pin");
    await expect(
      target.execSql(
        `SELECT signing_public_key, first_seen_at
         FROM trusted_user_identity_pins`,
      ),
    ).resolves.toEqual([
      {
        first_seen_at: targetPin.firstSeenAt,
        signing_public_key: targetPin.signingPublicKey,
      },
    ]);
    await expect(
      target.execSql("SELECT id, value FROM local_only_records"),
    ).resolves.toEqual([{ id: "local-1", value: "must survive" }]);
  } finally {
    source.close();
    target.close();
  }
});
