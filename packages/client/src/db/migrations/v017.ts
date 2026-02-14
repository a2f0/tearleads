import type { Migration } from './types';

/**
 * v017: Add wallet item and media link tables
 *
 * Adds local tables used by the wallet feature:
 * - wallet_items
 * - wallet_item_media
 */
export const v017: Migration = {
  version: 17,
  description: 'Add wallet_items and wallet_item_media tables',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "wallet_items" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "item_type" TEXT NOT NULL CHECK("item_type" IN ('passport', 'driverLicense', 'birthCertificate', 'creditCard', 'debitCard', 'identityCard', 'insuranceCard', 'other')),
        "display_name" TEXT NOT NULL,
        "issuing_authority" TEXT,
        "country_code" TEXT,
        "document_number_last4" TEXT,
        "issued_on" INTEGER,
        "expires_on" INTEGER,
        "notes" TEXT,
        "metadata" TEXT,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        "deleted" INTEGER NOT NULL DEFAULT 0 CHECK("deleted" IN (0, 1))
      )`,
      `CREATE INDEX IF NOT EXISTS "wallet_items_type_idx" ON "wallet_items" ("item_type")`,
      `CREATE INDEX IF NOT EXISTS "wallet_items_expires_idx" ON "wallet_items" ("expires_on")`,
      `CREATE INDEX IF NOT EXISTS "wallet_items_deleted_idx" ON "wallet_items" ("deleted")`,
      `CREATE INDEX IF NOT EXISTS "wallet_items_updated_idx" ON "wallet_items" ("updated_at")`,
      `CREATE TABLE IF NOT EXISTS "wallet_item_media" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "wallet_item_id" TEXT NOT NULL REFERENCES "wallet_items"("id") ON DELETE CASCADE,
        "file_id" TEXT NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
        "side" TEXT NOT NULL CHECK("side" IN ('front', 'back')),
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "wallet_item_media_item_idx" ON "wallet_item_media" ("wallet_item_id")`,
      `CREATE INDEX IF NOT EXISTS "wallet_item_media_file_idx" ON "wallet_item_media" ("file_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "wallet_item_media_item_side_idx" ON "wallet_item_media" ("wallet_item_id", "side")`
    ];

    await adapter.executeMany(statements);
  }
};
