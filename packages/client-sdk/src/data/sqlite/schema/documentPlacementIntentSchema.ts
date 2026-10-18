import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Additional link targets of a document placement intent in `localIntents`,
 * keyed by that intent's current revision id and settled with it.
 */
export const documentIntentLinkTargets = sqliteTable(
  "document_intent_link_targets",
  {
    intentId: text("intent_id").notNull(),
    operation: text("operation", { enum: ["link", "unlink"] })
      .notNull()
      .default("link"),
    containerId: text("container_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.intentId, table.containerId] })],
);
