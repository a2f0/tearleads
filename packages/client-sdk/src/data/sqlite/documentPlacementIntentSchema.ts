import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Device-first document moves waiting for remote link-set replay.
 *
 * A document move is applied to local projections immediately, then replayed as
 * remote link/unlink mutations when writer context is available. Replays are
 * rebuilt from current writer projections so the queue stores only intent.
 *
 * Columns:
 * - `id`: Client-generated intent id.
 * - `localId`: Local document row to update after replay.
 * - `documentId`: Server document id whose link set should move.
 * - `targetContainerId`: Desired active/final container id.
 * - `sourceContainerId`: Original active container to unlink for move-style
 *   intents. Replace-style intents unlink every remote container except target.
 * - `replaceLinkedContainers`: Whether the final remote link set should be
 *   only the target container.
 * - `intentType`: Intent discriminator, currently `document.move`.
 * - `syncStatus`: Current sync state, currently `pending` or `blocked`.
 * - `lastError`: Last sync error message for retry/debug display.
 * - `lastAttemptedAt`: Timestamp of the last replay attempt.
 * - `createdAt`: Intent creation timestamp used for FIFO sync.
 * - `updatedAt`: Local timestamp for the latest target/status/error change.
 *
 * Indexes:
 * - `id` is the primary key.
 * - `documentId` is unique so same-document moves coalesce to one intent.
 * - `(syncStatus, createdAt)` supports listing pending intents in queue order.
 */
export const documentMoveIntents = sqliteTable(
  "document_move_intents",
  {
    id: text("id"),
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull().unique(),
    targetContainerId: text("target_container_id").notNull(),
    sourceContainerId: text("source_container_id"),
    replaceLinkedContainers: integer("replace_linked_containers", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    intentType: text("intent_type").notNull(),
    syncStatus: text("sync_status").notNull(),
    lastError: text("last_error"),
    lastAttemptedAt: text("last_attempted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("document_move_intents_status_created_idx").on(
      table.syncStatus,
      table.createdAt,
    ),
  ],
);

/** Additional links share the parent placement intent revision and settlement. */
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
