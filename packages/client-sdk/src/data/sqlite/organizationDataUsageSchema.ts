import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "./sqlTableSchema";

export const ORGANIZATION_DATA_USAGE_PROJECTION_VERSION = 1 as const;

/** One server-computed usage snapshot per organization requester. */
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
    refreshedAt: text("refreshed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.requesterUserId] }),
  ],
);

/** Exact document-category rows belonging to a requester usage snapshot. */
export const organizationDataUsageCategories = sqliteTable(
  "organization_data_usage_categories",
  {
    organizationId: text("organization_id").notNull(),
    requesterUserId: text("requester_user_id").notNull(),
    category: text("category").notNull(),
    byteLength: integer("byte_length").notNull(),
    documentCount: integer("document_count").notNull(),
    updateCount: integer("update_count").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.requesterUserId, table.category],
    }),
  ],
);

export const organizationDataUsageTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(organizationDataUsageSnapshots),
  defineSqlTableSchema(organizationDataUsageCategories),
];

export const organizationDataUsageSQLiteSchema = {
  organizationDataUsageSnapshots,
  organizationDataUsageCategories,
};
