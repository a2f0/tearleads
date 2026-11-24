import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Where a document's last completed pull reached, what it was judged with,
 * and what the pull in progress started from. One row per document scope.
 *
 * Columns:
 * - `appKind`, `localId`: Document scope matching `documents`.
 * - `documentId`: The server document the pull read; a row for another id
 *   is never sent.
 * - `throughUpdateId`: The completed pull's upper bound, or null before one
 *   completes. Every update committed at or before it was either served and
 *   processed (imported or voided) or had a declared span the request's
 *   version already covered.
 * - `throughVersion`: The persisted content frontier (`snapshotEndVersion`)
 *   when the cursor was written. The cursor is sent only while the current
 *   frontier covers it, so a restore to older state pulls by version alone.
 * - `judge`: The void rules and Loro decoder the verdicts were reached with
 *   (`documentVerdictJudge`). A device whose judge changed sends no cursor
 *   until a pull without one has judged every uncovered update again.
 * - `pullJudge`, `pullSentCursor`: The judge and the cursor of the first page
 *   of the pull in progress (`pullJudge` is null when none is). A pull
 *   advances the cursor only if every later page ran under the same two.
 */
export const documentSyncProgress = sqliteTable(
  "document_sync_progress",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull(),
    throughUpdateId: text("through_update_id"),
    throughVersion: text("through_version"),
    judge: text("judge"),
    pullJudge: text("pull_judge"),
    pullSentCursor: text("pull_sent_cursor"),
  },
  (table) => [primaryKey({ columns: [table.appKind, table.localId] })],
);

/**
 * Served updates this device will never apply: their payload is not the
 * update their signed metadata declares, or they cannot join the history
 * built from every earlier served update. Each is reported once, when its
 * row is first written; none sets the document's sync failure.
 *
 * Columns:
 * - `appKind`, `localId`, `documentId`: Document scope and server document.
 * - `updateId`: The voided update.
 * - `stage`, `message`: Where judging failed and why, for diagnostics. A
 *   `loro_runtime` row is a void only once `attempts` reaches
 *   `MAX_LORO_RUNTIME_ATTEMPTS`; until then the update is unsettled and
 *   judged again.
 * - `attempts`: For a `loro_runtime` row, how many process lifetimes have
 *   each failed the Loro runtime on the update; null at other stages.
 * - `judge`: As in `document_sync_progress`. A verdict needs no content key
 *   beside it: the update's signed envelope commits to the one key every
 *   reader judges it under.
 * - `voidedAt`: When this device first voided it.
 */
export const documentVoidUpdates = sqliteTable(
  "document_void_updates",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull(),
    updateId: text("update_id").notNull(),
    stage: text("stage").notNull(),
    message: text("message").notNull(),
    attempts: integer("attempts"),
    judge: text("judge").notNull(),
    voidedAt: text("voided_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appKind, table.localId, table.updateId] }),
  ],
);

/**
 * Served updates this device voided because they reused ids of operations it
 * holds under its own peer id with other operations: their writer committed
 * operations as this device, and a reader that judged that update before
 * this device's own voids this device's. A notice outlives its void row and
 * is reported once, when written.
 *
 * Columns:
 * - `appKind`, `localId`, `documentId`: Document scope and server document.
 * - `updateId`: The update that reused this device's operation ids.
 * - `peerId`: This device's peer id it reused.
 * - `writerUserId`, `authorFingerprint`: Who signed that update, when the
 *   served write header said. For a rotation baseline this is the writer
 *   that relayed the operations, not necessarily the one that forged them.
 * - `noticedAt`: When this device first voided it.
 */
export const documentPeerPreemptions = sqliteTable(
  "document_peer_preemptions",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull(),
    updateId: text("update_id").notNull(),
    peerId: text("peer_id").notNull(),
    writerUserId: text("writer_user_id"),
    authorFingerprint: text("author_fingerprint"),
    noticedAt: text("noticed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appKind, table.localId, table.updateId] }),
  ],
);

export const documentSyncVerdictTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentSyncProgress),
  defineSqlTableSchema(documentVoidUpdates),
  defineSqlTableSchema(documentPeerPreemptions),
];
