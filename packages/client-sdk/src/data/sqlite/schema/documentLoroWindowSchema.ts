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
 * - `contentKeyEpoch`, `keyFingerprint`: For a counting window, the update's
 *   epoch and content-key fingerprint, so the attempt is recorded under the
 *   key it was read with.
 * - `judge`: The judge (`documentVerdictJudge`) the window read with. A
 *   window left by another judge counts nothing.
 * - `openedAt`: When it was opened, for diagnostics.
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
    contentKeyEpoch: integer("content_key_epoch"),
    keyFingerprint: text("key_fingerprint"),
    judge: text("judge").notNull(),
    openedAt: text("opened_at").notNull(),
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

export const documentLoroWindowTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentLoroWindows),
  defineSqlTableSchema(documentLoroIsolation),
];
