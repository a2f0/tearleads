import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Records of ordinary documents that a container listing showed moved past
 * what the record last read, and that still owe a read. A document whose
 * lane covers it is not probed when its store opens or its socket
 * reconnects, so this row is what recovers an edit or an access change whose
 * hint was lost. It is written before the lane watermark advances past the
 * listed row, so a restart before the read still owes it.
 *
 * A debt belongs to one record, not to the document: after an identity
 * recovery or a relink two records can name one server document, and each
 * keeps its own cursor and key bundle. A store reads and settles only its own
 * record's debt.
 *
 * Columns:
 * - `localId`: The record that owes the read.
 * - `documentId`: The server document the listing named; a record that now
 *   names another document no longer owes it.
 * - `advertisedUpdateCount`: The most updates a listing counted for it; a
 *   read settles the request only once the record's processed cursor covers
 *   them.
 * - `advertisedAccessEpoch`: The epoch of the newest access head a listing
 *   showed. Each head of a document has its own epoch, and a head move
 *   raises it, so a read settles the request only once the manifest the
 *   record's last pull saved is at that epoch or a later one.
 * - `revision`: Replaced on every request, so a read settles only the
 *   request it saw before it began.
 * - `requestedAt`: When this device last recorded the request.
 */
export const documentListingRevalidations = sqliteTable(
  "document_listing_revalidations",
  {
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull(),
    advertisedUpdateCount: integer("advertised_update_count").notNull(),
    advertisedAccessEpoch: integer("advertised_access_epoch").notNull(),
    revision: text("revision").notNull(),
    requestedAt: text("requested_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.localId] })],
);

export const documentListingRevalidationTables: ReadonlyArray<SqlTableSchema> =
  [
    {
      ...defineSqlTableSchema(documentListingRevalidations),
      requiredColumns: ["local_id", "advertised_access_epoch"],
    },
  ];
