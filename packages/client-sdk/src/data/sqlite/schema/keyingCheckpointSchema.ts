import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";
import { organizationFounders } from "./organizationFounderSchema";
import { principalGrantRetirements } from "./principalGrantRetirementSchema";
import { principalPolicyCheckpointTable } from "./principalPolicySchema";

/**
 * Anti-rollback pin for verified access manifests.
 *
 * Records the highest access-manifest epoch this client has verified for each
 * object, so a later projection that serves an older epoch (rollback) or a
 * conflicting manifest at the same epoch (equivocation) is detected before any
 * key is unwrapped. Updated monotonically after a projection verifies cleanly.
 *
 * Columns:
 * - `objectKind`: Access object kind (`container`, `document`, ...).
 * - `organizationId`: Organization boundary that owns the object.
 * - `objectId`: Stable object id.
 * - `epoch`: Highest verified manifest epoch.
 * - `manifestHash`: Manifest hash pinned at that epoch.
 * - `updatedAt`: Local timestamp for the pin.
 *
 * Indexes:
 * - `(objectKind, organizationId, objectId)` is the primary key and gives one
 *   pin per object.
 */
export const accessManifestCheckpoints = sqliteTable(
  "access_manifest_checkpoints",
  {
    objectKind: text("object_kind").notNull(),
    organizationId: text("organization_id").notNull(),
    objectId: text("object_id").notNull(),
    epoch: integer("epoch").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.objectKind, table.organizationId, table.objectId],
    }),
  ],
);

/**
 * Durable terminal pins for documents whose signed purge proof was verified.
 * These survive remote-state resets so a dishonest API cannot later replay the
 * pre-purge writer projection and resurrect locally deleted content.
 */
export const documentPurgeCheckpoints = sqliteTable(
  "document_purge_checkpoints",
  {
    documentId: text("document_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    documentManifestHash: text("document_manifest_hash").notNull(),
    purgeEventHash: text("purge_event_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const keyingCheckpointTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(organizationFounders),
  defineSqlTableSchema(accessManifestCheckpoints),
  defineSqlTableSchema(principalGrantRetirements),
  defineSqlTableSchema(documentPurgeCheckpoints),
  principalPolicyCheckpointTable,
];
