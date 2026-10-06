import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema } from "./sqlTableSchema";

/** A completed, locally authenticated prefix; never an application trust pin. */
export const principalHistoryPrefixes = sqliteTable(
  "principal_history_prefixes",
  {
    scopeId: text("scope_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    version: integer("version").notNull(),
    headJson: text("head_json").notNull(),
    currentJson: text("current_json").notNull(),
    progress: text("progress").notNull(),
  },
  (table) => [
    index("principal_history_prefixes_organization_idx").on(
      table.organizationId,
    ),
  ],
);

/** Entries are selected by their exact signed leaf, including signature bytes. */
export const principalHistoryEntries = sqliteTable(
  "principal_history_entries",
  {
    scopeId: text("scope_id").notNull(),
    organizationId: text("organization_id").notNull(),
    leafHash: text("leaf_hash").notNull(),
    entryJson: text("entry_json").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.leafHash] }),
    index("principal_history_entries_organization_idx").on(
      table.organizationId,
    ),
  ],
);

/** Untrusted proof material, checked against a locally restored private root. */
export const principalHistoryNodes = sqliteTable(
  "principal_history_nodes",
  {
    scopeId: text("scope_id").notNull(),
    organizationId: text("organization_id").notNull(),
    hash: text("hash").notNull(),
    leftHash: text("left_hash").notNull(),
    rightHash: text("right_hash").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.hash] }),
    index("principal_history_nodes_organization_idx").on(table.organizationId),
  ],
);

export const principalHistoryEvidenceTables = [
  defineSqlTableSchema(principalHistoryPrefixes),
  defineSqlTableSchema(principalHistoryEntries),
  defineSqlTableSchema(principalHistoryNodes),
];
