import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
 *   `container_documents`.
 * - `laneId`: Lane identity. Root parent sync uses `root`, child sync uses a
 *   parent-prefixed container id, and document lanes use the container id.
 * - `watermarkUpdatedAt`: Server `updatedAt` value for the stored watermark;
 *   null until a watermark is saved.
 * - `watermarkId`: Server id tie-breaker for the stored watermark; null
 *   exactly when `watermarkUpdatedAt` is.
 * - `updatedAt`: Local timestamp for when the cursor was saved.
 * - `checkedAt`: Local timestamp for the most recent fully drained lane check;
 *   null until one completes.
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
    updatedAt: text("updated_at"),
    checkedAt: text("checked_at"),
  },
  (table) => [primaryKey({ columns: [table.laneKind, table.laneId] })],
);

export const containerSyncWatermarkTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(containerSyncWatermarks),
    requiredColumns: ["checked_at"],
  },
];
