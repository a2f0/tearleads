import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Per-lane sync state for container data: the server cursor and the local
 * freshness marker share one row per lane.
 *
 * Container sync is split into lanes, such as a parent-container child lane or
 * a container-document membership lane. The cursor lets the next request
 * resume without replaying the entire tree. The freshness marker records the
 * last fully drained check independently of the cursor: empty server
 * responses do not always carry a new watermark, but startup still needs to
 * know that it recently checked the lane before polling again.
 *
 * Columns:
 * - `laneKind`: Sync lane category, such as `container_parent` or
 *   `container_documents`. `container_restoration` stores the last reconciled
 *   access loss for a folder.
 * - `laneId`: Lane identity. Root parent sync uses `root`, child sync uses a
 *   parent-prefixed container id, and document lanes use the container id.
 * - `watermarkUpdatedAt`: Server `updatedAt` value for the stored watermark;
 *   null until a watermark is saved.
 * - `watermarkId`: Server id tie-breaker for the stored watermark; null
 *   exactly when `watermarkUpdatedAt` is.
 * - `cursorFormat`: SDK format that applied the saved watermark.
 * - `updatedAt`: Local timestamp for when the cursor was saved.
 * - `checkedAt`: Local timestamp for the most recent fully drained lane check;
 *   null until one completes. On a `container_documents` lane it marks the
 *   lane settled: an applied listing left no candidate pending. A lane
 *   without it still owes a listing, which the reconciler resumes at start
 *   (see `documentLaneDiscovery.ts`).
 *
 * Indexes:
 * - `(laneKind, laneId)` is the primary key and stores one row per lane.
 */
export const containerSyncWatermarks = sqliteTable(
  "container_sync_watermarks",
  {
    laneKind: text("lane_kind").notNull(),
    laneId: text("lane_id").notNull(),
    watermarkUpdatedAt: text("watermark_updated_at"),
    watermarkId: text("watermark_id"),
    cursorFormat: integer("cursor_format").notNull().default(1),
    updatedAt: text("updated_at"),
    checkedAt: text("checked_at"),
  },
  (table) => [primaryKey({ columns: [table.laneKind, table.laneId] })],
);

/**
 * Containers whose document lane a tree listing showed may have moved, and
 * that still owe a listing. Every server write that changes what a
 * container's document lane returns republishes the container's row, so a
 * tree listing that is served the row owes the lane one listing. The catch-up
 * after an acknowledged connection lists only the lanes owed here, and the
 * lanes that never settled, instead of every lane it knows. The row is
 * written before the serving lane's watermark advances past the container's
 * row, so a restart before the listing still owes it.
 *
 * Columns:
 * - `containerId`: The container whose document lane is owed a listing.
 * - `revision`: Replaced on every request. A listing settles only the
 *   request it read before it began: a listing already in flight when the
 *   row was served may have been answered before the change behind it.
 * - `requestedAt`: When this device last recorded the request.
 */
export const documentLaneRevalidations = sqliteTable(
  "document_lane_revalidations",
  {
    containerId: text("container_id").notNull(),
    revision: text("revision").notNull(),
    requestedAt: text("requested_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.containerId] })],
);

export const containerSyncWatermarkTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(containerSyncWatermarks),
    requiredColumns: ["checked_at", "cursor_format"],
  },
  defineSqlTableSchema(documentLaneRevalidations),
];
