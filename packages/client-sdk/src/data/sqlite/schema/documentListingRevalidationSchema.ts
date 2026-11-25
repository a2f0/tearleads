import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Ordinary documents a container listing showed with more updates than this
 * device's processed cursor covers, and that still owe a read. A document
 * whose lane covers it is not probed when its store opens or its socket
 * reconnects, so this row is what recovers an edit whose hint was lost. It is
 * written before the lane watermark advances past the listed row, so a
 * restart before the read still owes it.
 *
 * Columns:
 * - `documentId`: The server document the listing named.
 * - `advertisedUpdateCount`: The most updates a listing counted for it; a
 *   read settles the request only once a processed cursor covers them.
 * - `revision`: Replaced on every request, so a read settles only the
 *   request it saw before it began.
 * - `requestedAt`: When this device last recorded the request.
 */
export const documentListingRevalidations = sqliteTable(
  "document_listing_revalidations",
  {
    documentId: text("document_id").notNull(),
    advertisedUpdateCount: integer("advertised_update_count").notNull(),
    revision: text("revision").notNull(),
    requestedAt: text("requested_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId] })],
);

export const documentListingRevalidationTables: ReadonlyArray<SqlTableSchema> =
  [defineSqlTableSchema(documentListingRevalidations)];
