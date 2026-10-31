import { desc } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { principalCurrentFingerprintJson } from "../principalKeyFingerprintJson";
import { defineSqlTableSchema } from "../sqlTableSchema";
import { principalHistoryNodeRetentionTables } from "./principalHistoryNodeRetentionSchema";

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
    index("principal_history_prefixes_key_fingerprint_idx").on(
      principalCurrentFingerprintJson(table.currentJson),
      desc(table.version),
    ),
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

/**
 * One row per hash a scope's graph mentions. Child hashes are set once the
 * node itself is stored: that untrusted proof material is checked against a
 * locally restored private root. A row without them is a liveness placeholder
 * for a referenced hash, such as a leaf or a root not stored yet. The count and
 * `managed` flag are disposable liveness hints for reclamation.
 */
export const principalHistoryNodes = sqliteTable(
  "principal_history_nodes",
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
    index("principal_history_nodes_reclaim_idx").on(
      table.scopeId,
      table.organizationId,
      table.managed,
      table.referenceCount,
      table.hash,
    ),
    index("principal_history_nodes_organization_idx").on(table.organizationId),
  ],
);

export const principalHistoryEvidenceTables = [
  ...principalHistoryNodeRetentionTables,
  {
    ...defineSqlTableSchema(principalHistoryPrefixes),
    requiredColumns: ["current_json"],
  },
  defineSqlTableSchema(principalHistoryEntries),
  {
    ...defineSqlTableSchema(principalHistoryNodes),
    requiredColumns: ["reference_count"],
  },
];
