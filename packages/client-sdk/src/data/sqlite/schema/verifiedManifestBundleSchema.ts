import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Access-manifest bundles this device verified inside a writer projection,
 * keyed by manifest hash. A later projection read cites them so the API can
 * omit their bytes; the client refills each omission from this row and
 * verifies the rebuilt projection from scratch. Rows are neither trust nor
 * checkpoint state: a missing, evicted, or damaged row only costs bytes.
 *
 * Container KEK levels share the table as typed rows (`objectKind`
 * `container-kek-level`), keyed by the SHA-256 of their canonical wire bytes.
 *
 * Columns:
 * - `manifestHash`: Citation key: the stored bundle's `manifestHash`, or a
 *   level row's digest.
 * - `organizationId`, `objectKind`, `objectId`, `epoch`: The verified
 *   manifest's object (or the level's container and key epoch), used to cite
 *   the lineage relevant to a request.
 * - `bundleJson`: The exact verified bundle as JSON.
 * - `bundleDigest`: SHA-256 hex of `bundleJson`; a mismatch drops the row.
 * - `verifiedAt`: Latest local verification time; oldest rows evict first.
 */
export const verifiedAccessManifestBundles = sqliteTable(
  "verified_access_manifest_bundles",
  {
    manifestHash: text("manifest_hash").primaryKey(),
    organizationId: text("organization_id").notNull(),
    objectKind: text("object_kind").notNull(),
    objectId: text("object_id").notNull(),
    epoch: integer("epoch").notNull(),
    bundleJson: text("bundle_json").notNull(),
    bundleDigest: text("bundle_digest").notNull(),
    verifiedAt: text("verified_at").notNull(),
  },
  (table) => [
    index("verified_access_manifest_bundles_object_idx").on(
      table.objectKind,
      table.objectId,
      desc(table.epoch),
    ),
    // Eviction order: oldest verification first, hash as the tiebreak.
    index("verified_access_manifest_bundles_eviction_idx").on(
      table.verifiedAt,
      table.manifestHash,
    ),
    // Recent citations: an organization's newest verifications first.
    index("verified_access_manifest_bundles_organization_recent_idx").on(
      table.organizationId,
      desc(table.verifiedAt),
      table.manifestHash,
    ),
  ],
);

export const verifiedManifestBundleTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(verifiedAccessManifestBundles),
];
