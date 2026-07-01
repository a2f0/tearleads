import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "./columns";

interface KeyPackageBackupCredentialMetadata {
  readonly id: string;
  readonly publicKey: string;
  readonly publicKeyAlgorithm: number;
  readonly transports: readonly string[];
  readonly type: "public-key";
}

interface KeyPackageBackupEncryptedEnvelope {
  readonly ciphertext: string;
  readonly encryptionSuite: "aes-256-gcm";
  readonly format: "tearleads.identity-key-package.passkey-backup";
  readonly iv: string;
  readonly version: 1;
}

/**
 * Zero-knowledge remote backups of a user's identity key package.
 *
 * The API stores only WebAuthn public credential metadata and encrypted key
 * package bytes. The passkey PRF output and derived wrapping key never enter
 * this table; browsers derive them locally during enrollment/restore.
 */
export const keyPackageBackups = pgTable(
  "key_package_backups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    signingKeyFingerprint: text("signing_key_fingerprint").notNull(),
    credentialId: text("credential_id").notNull().unique(),
    credential: jsonb("credential")
      .$type<KeyPackageBackupCredentialMetadata>()
      .notNull(),
    prfSalt: text("prf_salt").notNull(),
    prfSaltVersion: integer("prf_salt_version").default(1).notNull(),
    kdfSuite: text("kdf_suite").notNull(),
    envelope: jsonb("envelope")
      .$type<KeyPackageBackupEncryptedEnvelope>()
      .notNull(),
    backupVersion: integer("backup_version").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("key_package_backups_user_updated_idx").on(
      table.userId,
      table.updatedAt,
      table.id,
    ),
    index("key_package_backups_fingerprint_idx").on(
      table.signingKeyFingerprint,
    ),
  ],
);
