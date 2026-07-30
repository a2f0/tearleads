import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "./sqlTableSchema";

const accessLevelColumn = "effective_access_level";

/**
 * Materialized local container tree.
 *
 * Container rows describe the tree and its encrypted metadata document. Display
 * fields are kept in `containerProjection`; metadata rows live in `documents`.
 * `id` is the primary key for structural lookups. `metadataDocumentId` is the
 * server metadata-document id when known; `systemSlot` is an optional opaque
 * app-owned slot. Local timestamps track client storage/structural changes,
 * while server timestamps are populated once the container has synced.
 */
export const containers = sqliteTable(
  "containers",
  {
    id: text("id"),
    organizationId: text("organization_id").notNull(),
    parentId: text("parent_id"),
    metadataDocumentId: text("metadata_document_id"),
    systemSlot: text("system_slot"),
    effectiveAccessLevel: text(accessLevelColumn).notNull().default("read"),
    localCreatedAt: text("local_created_at").notNull(),
    localUpdatedAt: text("local_updated_at").notNull(),
    serverCreatedAt: text("server_created_at"),
    serverUpdatedAt: text("server_updated_at"),
  },
  (table) => [primaryKey({ columns: [table.id] })],
);

/**
 * Organization attribution for container metadata retained after access loss.
 * The container row is removed on revocation, so this marker retains the
 * organization scope needed by a later access-restoration sweep.
 */
export const dormantContainerMetadata = sqliteTable(
  "dormant_container_metadata",
  {
    containerId: text("container_id").notNull(),
    organizationId: text("organization_id").notNull(),
    retainedAt: text("retained_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.containerId] }),
    index("dormant_container_metadata_organization_idx").on(
      table.organizationId,
      table.containerId,
    ),
  ],
);

/** Durable request for a post-access-restoration container crawl and sweep. */
export const dormantMetadataSweepRequests = sqliteTable(
  "dormant_metadata_sweep_requests",
  {
    organizationId: text("organization_id").notNull(),
    requesterUserId: text("requester_user_id").notNull(),
    generation: integer("generation").notNull().default(1),
    requestedAt: text("requested_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.requesterUserId] }),
  ],
);

/**
 * Decrypted container metadata read model.
 *
 * Container metadata is authored as a Loro document, but lists need a small
 * queryable projection for names and icons. `displayName` remains nullable so
 * presentation can fall back to `/` or `Untitled`; `containerId` is the primary
 * key joining the projection back to `containers.id`.
 */
export const containerProjection = sqliteTable(
  "container_projection",
  {
    containerId: text("container_id"),
    displayName: text("display_name"),
    icon: text("icon"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.containerId] })],
);

export const containerTableSchemas: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(containers),
  defineSqlTableSchema(containerProjection),
  defineSqlTableSchema(dormantContainerMetadata),
  defineSqlTableSchema(dormantMetadataSweepRequests),
];

export const containerSQLiteSchema = {
  containers,
  containerProjection,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
};
