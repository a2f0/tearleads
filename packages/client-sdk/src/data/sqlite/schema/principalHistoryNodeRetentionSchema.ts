import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema } from "../sqlTableSchema";

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
  defineSqlTableSchema(principalHistoryRootOwners),
];
