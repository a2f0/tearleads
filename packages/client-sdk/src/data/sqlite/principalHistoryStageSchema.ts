import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { principalCurrentFingerprintJson } from "./principalKeyFingerprintJson";
import { defineSqlTableSchema } from "./sqlTableSchema";

/** Provisional, locally authenticated verification work; never an app checkpoint. */
export const principalHistoryStages = sqliteTable(
  "principal_history_stages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    currentJson: text("current_json").notNull(),
    afterVersion: integer("after_version").notNull(),
    complete: integer("complete", { mode: "boolean" }).notNull(),
    progress: text("progress").notNull(),
  },
  (table) => [
    index("principal_history_stages_key_fingerprint_idx").on(
      principalCurrentFingerprintJson(table.currentJson),
      table.complete,
      desc(table.afterVersion),
    ),
    index("principal_history_stages_organization_idx").on(table.organizationId),
  ],
);

export const principalHistoryStageTables = [
  defineSqlTableSchema(principalHistoryStages),
];
