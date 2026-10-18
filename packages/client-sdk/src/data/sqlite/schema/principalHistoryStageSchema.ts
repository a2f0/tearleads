import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { principalCurrentFingerprintJson } from "../principalKeyFingerprintJson";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";
import { principalHistoryRetentionTables } from "./principalHistoryRetentionSchema";

/**
 * Provisional, locally authenticated verification work; never an app
 * checkpoint. `scopeId` and `touchedAt` are eviction hints for bounded
 * retention (which principal history the stage belongs to, and when a writer
 * last used it), never authenticated recovery state.
 */
export const principalHistoryStages = sqliteTable(
  "principal_history_stages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    scopeId: text("scope_id").notNull(),
    currentJson: text("current_json").notNull(),
    afterVersion: integer("after_version").notNull(),
    complete: integer("complete", { mode: "boolean" }).notNull(),
    touchedAt: integer("touched_at").notNull(),
    progress: text("progress").notNull(),
  },
  (table) => [
    index("principal_history_stages_key_fingerprint_idx").on(
      principalCurrentFingerprintJson(table.currentJson),
      table.complete,
      desc(table.afterVersion),
    ),
    index("principal_history_stages_organization_idx").on(table.organizationId),
    index("principal_history_stages_scope_idx").on(
      table.scopeId,
      table.organizationId,
      table.complete,
      desc(table.afterVersion),
      desc(table.touchedAt),
      table.id,
    ),
    index("principal_history_stages_incomplete_idx").on(
      table.scopeId,
      table.organizationId,
      table.complete,
      desc(table.touchedAt),
      table.id,
    ),
  ],
);

export const principalHistoryStageTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(principalHistoryStages),
    requiredColumns: ["scope_id", "touched_at"],
  },
  ...principalHistoryRetentionTables,
];
