import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "./sqlTableSchema";

export const ORGANIZATION_DATA_USAGE_PROJECTION_VERSION = 1 as const;

/**
 * One server-computed usage snapshot per organization requester. The
 * per-category document breakdown is the response's own array, stored as
 * JSON in canonical category order in `categoryBreakdownJson` and re-validated
 * against the response schema on every read; a row that fails is purged.
 */
export const organizationDataUsageSnapshots = sqliteTable(
  "organization_data_usage_snapshots",
  {
    organizationId: text("organization_id").notNull(),
    requesterUserId: text("requester_user_id").notNull(),
    projectionVersion: integer("projection_version").notNull(),
    blobCount: integer("blob_count").notNull(),
    blobByteLength: integer("blob_byte_length").notNull(),
    documentByteLength: integer("document_byte_length").notNull(),
    documentCount: integer("document_count").notNull(),
    documentUpdateCount: integer("document_update_count").notNull(),
    totalByteLength: integer("total_byte_length").notNull(),
    categoryBreakdownJson: text("category_breakdown_json").notNull(),
    refreshedAt: text("refreshed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.requesterUserId] }),
  ],
);

export const organizationDataUsageTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(organizationDataUsageSnapshots),
    requiredColumns: ["category_breakdown_json"],
  },
];

export const organizationDataUsageSQLiteSchema = {
  organizationDataUsageSnapshots,
};
