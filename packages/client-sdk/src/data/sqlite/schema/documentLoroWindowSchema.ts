import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * A lifetime reading served updates with Loro. The row is committed once
 * the reader's history is built, before the page's first update is read,
 * and deleted when the page's save commits, so a row whose lifetime has
 * ended was left by a process that died inside it (#3194). One row per
 * document scope and lifetime: a second pass reading the scope at once
 * replaces it, and each pass deletes only the row it wrote.
 *
 * Columns:
 * - `appKind`, `localId`, `documentId`: Document scope and server document.
 * - `lifetimeId`: The lifetime (`loroLifetime.ts`) that opened it.
 * - `windowId`: The window, of the lifetime's, that wrote the row.
 * - `updateIds`: The page's unsettled updates in server order, as a JSON
 *   array: those it reads with Loro, not its known voids.
 * - `counts`: 1 when the window held one update and its lifetime had met no
 *   Loro runtime failure, so a death inside it is an attempt toward that
 *   update; 0 when a death isolates the window's updates instead.
 * - `judge`: The judge (`documentVerdictJudge`) the window read with. A
 *   window left by another judge counts nothing.
 * - `openedAt`: When it was opened, for diagnostics.
 * - `kind`: What a death inside it is charged to (`LoroWindowKind`): `read`
 *   counts toward the update it held alone; `rotation`, a key rotation's
 *   rebuild of history the device accepted, counts toward that rotation
 *   (`document_rotation_availability`) and never toward an update.
 */
export const documentLoroWindows = sqliteTable(
  "document_loro_windows",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    lifetimeId: text("lifetime_id").notNull(),
    windowId: text("window_id").notNull(),
    documentId: text("document_id").notNull(),
    updateIds: text("update_ids").notNull(),
    counts: integer("counts").notNull(),
    judge: text("judge").notNull(),
    openedAt: text("opened_at").notNull(),
    // Last, where migration step 9 added it to existing tables.
    kind: text("kind").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.appKind, table.localId, table.lifetimeId],
    }),
  ],
);

/**
 * Updates a death left unattributed: a window of several updates, or one
 * read by a lifetime that had already failed. While a scope has suspects its
 * pulls ask for one update a page, so each is read alone and a later death
 * counts toward it. One row per document scope.
 *
 * Columns:
 * - `appKind`, `localId`, `documentId`: Document scope and server document.
 * - `suspects`: The updates, as a JSON array. A page that commits removes
 *   those it served, and a completed pull removes the rest.
 */
export const documentLoroIsolation = sqliteTable(
  "document_loro_isolation",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull(),
    suspects: text("suspects").notNull(),
  },
  (table) => [primaryKey({ columns: [table.appKind, table.localId] })],
);

/**
 * Whether this device still starts key rotations of a document, given the
 * deaths its rotations' history rebuilds met (`rotationAvailabilityMachine`).
 * No row means available. One row per document scope.
 *
 * Columns:
 * - `appKind`, `localId`, `documentId`: Document scope and server document.
 * - `judge`: The judge (`documentVerdictJudge`) the deaths came under. A row
 *   for another judge or server document stands for nothing: a new decoder
 *   starts over.
 * - `status`: `dying` while deaths are below the limit; `unavailable` once
 *   they reach it, after which this device starts no rotation of the
 *   document and leaves it to other members.
 * - `deaths`: Lifetimes that died rebuilding the document's history for a
 *   rotation, alone in their windows, since its last completed rebuild.
 * - `changedAt`: When the row last changed, for diagnostics.
 */
export const documentRotationAvailability = sqliteTable(
  "document_rotation_availability",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull(),
    judge: text("judge").notNull(),
    status: text("status").notNull(),
    deaths: integer("deaths").notNull(),
    changedAt: text("changed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.appKind, table.localId] })],
);

export const documentLoroWindowTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentLoroWindows),
  defineSqlTableSchema(documentLoroIsolation),
  defineSqlTableSchema(documentRotationAvailability),
];
