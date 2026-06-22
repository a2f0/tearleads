import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";
import type { ContainerSyncTombstoneReason } from "./shared";

/**
 * Materialized container tree structure.
 *
 * This table stores only the mutable structural shape needed for container
 * listing and parent-child checks. Authorization, grants, metadata-document
 * pointers, and KEK target state are verified from signed access manifests and
 * their projection tables.
 *
 * Columns:
 * - `id`: Stable container id.
 * - `organizationId`: Organization boundary for the container. Parent and child
 *   containers must stay within the same organization.
 * - `parentId`: Parent container id, or `null` for the organization's root
 *   container.
 * - `systemSlot`: Optional opaque app-owned system slot. System containers
 *   are rooted under the organization root and cannot be removed through the
 *   public container delete API.
 * - `depth`: Materialized distance from the root container. Roots are `0`.
 * - `createdAt`: Server-side insertion timestamp.
 * - `updatedAt`: Server-side sync timestamp bumped when the container,
 *   metadata document, or visible contents change.
 *
 * Indexes:
 * - `organizationId where parentId is null` is unique so an organization has
 *   one root container.
 * - `organizationId, systemSlot where systemSlot is not null` keeps each
 *   system slot unique per organization.
 * - `parentId` supports direct child lookups and move validation.
 * - `(parentId, updatedAt, id)` supports parent-container sync lanes.
 * - `(organizationId, depth, updatedAt, id)` keeps depth indexed for tree
 *   traversal and depth-bounded maintenance.
 */
export const containers = pgTable(
  "containers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    parentId: uuid("parent_id"),
    systemSlot: text("system_slot"),
    depth: integer("depth").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("containers_org_root_idx")
      .on(table.organizationId)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("containers_org_system_slot_idx")
      .on(table.organizationId, table.systemSlot)
      .where(sql`${table.systemSlot} is not null`),
    index("containers_parent_id_idx").on(table.parentId),
    index("containers_parent_updated_idx").on(
      table.parentId,
      table.updatedAt,
      table.id,
    ),
    index("containers_org_depth_updated_idx").on(
      table.organizationId,
      table.depth,
      table.updatedAt,
      table.id,
    ),
    index("containers_parent_depth_idx").on(table.parentId, table.depth),
  ],
);

/**
 * Per-user tombstones for containers that should be removed from a local sync
 * view. This is intentionally scoped to a user because removals caused by
 * access changes are visibility decisions, not global object deletion facts.
 *
 * The parent-lane index mirrors the live container scan so a client can request
 * tombstones for the same parent container watermark it uses for live rows. A
 * separate root-discovery marker covers directly granted non-root containers,
 * which are discoverable from root even though their stored `parentId` is the
 * real parent lane.
 */
export const containerSyncTombstones = pgTable(
  "container_sync_tombstones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    containerId: uuid("container_id").notNull(),
    parentId: uuid("parent_id"),
    depth: integer("depth").notNull(),
    reason: text("reason").$type<ContainerSyncTombstoneReason>().notNull(),
    rootDiscoveryVisible: boolean("root_discovery_visible")
      .default(false)
      .notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("container_sync_tombstones_user_container_idx").on(
      table.userId,
      table.containerId,
    ),
    index("container_sync_tombstones_user_parent_updated_idx").on(
      table.userId,
      table.parentId,
      table.updatedAt,
      table.containerId,
    ),
    index("container_sync_tombstones_user_root_updated_idx").on(
      table.userId,
      table.rootDiscoveryVisible,
      table.updatedAt,
      table.containerId,
    ),
  ],
);
