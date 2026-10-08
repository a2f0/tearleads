import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema } from "./sqlTableSchema";

/** Disposable graph liveness hints. Proof verification still authenticates every node. */
export const principalHistoryNodeReferences = sqliteTable(
  "principal_history_node_references",
  {
    scopeId: text("scope_id").notNull(),
    organizationId: text("organization_id").notNull(),
    hash: text("hash").notNull(),
    referenceCount: integer("reference_count").notNull(),
    managed: integer("managed", { mode: "boolean" }).notNull(),
    leftHash: text("left_hash"),
    rightHash: text("right_hash"),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.hash] }),
    index("principal_history_node_references_reclaim_idx").on(
      table.scopeId,
      table.organizationId,
      table.managed,
      table.referenceCount,
      table.hash,
    ),
    index("principal_history_node_references_organization_idx").on(
      table.organizationId,
    ),
  ],
);

/** A saved stage or prefix keeps its proof root live until its guarded replacement. */
export const principalHistoryRootOwners = sqliteTable(
  "principal_history_root_owners",
  {
    id: text("id").primaryKey(),
    scopeId: text("scope_id").notNull(),
    organizationId: text("organization_id").notNull(),
    rootHash: text("root_hash").notNull(),
  },
  (table) => [
    index("principal_history_root_owners_organization_idx").on(
      table.organizationId,
    ),
  ],
);

export const principalHistoryNodeRetentionTables = [
  defineSqlTableSchema(principalHistoryNodeReferences),
  defineSqlTableSchema(principalHistoryRootOwners),
];
