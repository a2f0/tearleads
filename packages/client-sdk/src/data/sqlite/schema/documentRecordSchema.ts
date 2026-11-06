import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

const accessLevelColumn = "effective_access_level";
/**
 * Durable Loro-backed document records shared by app features.
 *
 * This table stores encrypted document runtime state for multiple app domains.
 * `appKind` namespaces records for documents and container metadata. User-facing
 * list data is projected into feature-specific read models.
 *
 * Columns:
 * - `appKind`: Local domain namespace for the row, such as `documents` or
 *   `container-metadata`.
 * - `localId`: Stable local id inside `appKind`. It may be created before a
 *   server `documentId` exists.
 * - `documentId`: Server document id once the record is known remotely, or
 *   `null` while the document is local-only.
 * - `accessEpoch`: Latest access epoch persisted for the document. Defaults to
 *   the initial epoch.
 * - `accessStateHash`: Current document access/manifest state hash returned by
 *   sync, when known.
 * - `lastCommitLsn`: Last remote commit cursor applied to this local document.
 * - `documentManifestBundle`: Serialized document manifest bundle used for
 *   encrypted document sync.
 * - `contentKeyBundle`: Serialized content-key material needed to open the
 *   local document.
 * - `documentKekTargets`: Serialized KEK target state for document key wraps.
 * - `pendingBaseVersion`: Encoded oplog version through which every persisted
 *   op is already enqueued or synced. Persisted so a restart restores the
 *   outgoing-delta marker instead of re-seeding it past a device-first
 *   `deferRemoteSync` write's un-advanced op. `null` when unset.
 * - `snapshotEndVersion`: Encoded end version vector of the persisted content
 *   (which lives in the durable-history tables, never on this row), written on
 *   every content persist. Lets the pending-write queue's deferred-tail scan
 *   compare version coverage without loading content. Empty string when the
 *   document has never hydrated content, which readers treat as "no deferred
 *   tail claimable".
 * - `recoveryGeneration`: Atomic raw-history recovery writer fence.
 * - `recoveryDocumentId`: Former server id for cross-client post-purge recreation.
 * - `pullContinuation`: Durable progress for the next bounded remote pull.
 * - `syncFailureStatus`, `syncFailureMessage`, `syncFailureAttemptedAt`: The
 *   last terminal sync failure or quarantined incoming update for this scope.
 *   The durable write queue (queued rows of `documentHistoryUpdates`) has no
 *   status columns, so these let the write-queue view and footer explain why
 *   the document is blocked. `syncFailureMessage` is non-null exactly when a
 *   failure is recorded; a newer failure replaces the old, and a later fully
 *   validated sync pass, a remote reset, or the scope's teardown clears all
 *   three.
 * - `updatedAt`: Local timestamp for the last persisted runtime-state update.
 *
 * Indexes:
 * - `(appKind, localId)` is the primary key and scopes local document lookups.
 * - `(appKind, documentId) where documentId is not null` supports resolving a
 *   server document id back to the local row during discovery and relinking.
 */
export const documents = sqliteTable(
  "documents",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id"),
    accessEpoch: integer("access_epoch").notNull().default(1),
    accessStateHash: text("access_state_hash"),
    effectiveAccessLevel: text(accessLevelColumn).notNull().default("read"),
    lastCommitLsn: text("last_commit_lsn"),
    documentManifestBundle: text("document_manifest_bundle"),
    contentKeyBundle: text("content_key_bundle"),
    documentKekTargets: text("document_kek_targets"),
    pendingBaseVersion: text("pending_base_version"),
    pullContinuation: text("pull_continuation"),
    recoveryGeneration: integer("recovery_generation").notNull().default(0),
    recoveryDocumentId: text("recovery_document_id"),
    snapshotEndVersion: text("snapshot_end_version").notNull().default(""),
    syncFailureStatus: integer("sync_failure_status"),
    syncFailureMessage: text("sync_failure_message"),
    syncFailureAttemptedAt: text("sync_failure_attempted_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appKind, table.localId] }),
    index("documents_app_document_idx")
      .on(table.appKind, table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
  ],
);

/**
 * Full-history persistence for local documents (checkpoint + tail) — the ONLY
 * durable content source. Record rows in `documents` carry runtime metadata
 * and the content frontier (`snapshotEndVersion`), never content. The
 * checkpoint holds a full-history snapshot refreshed only at compaction, and
 * the tail appends every update (local deltas and decrypted remote updates)
 * written since. Restore = import checkpoint + replay tail; compaction =
 * export full history from the live doc, replace the checkpoint, clear the
 * tail — all bounded and amortized. Container metadata stores its content (an
 * exported-updates blob) as its checkpoint row, with no tail.
 */
export const documentHistoryCheckpoints = sqliteTable(
  "document_history_checkpoints",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    snapshot: text("snapshot").notNull(),
    endVersionVector: text("end_version_vector").notNull(),
    revision: text("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.appKind, table.localId] })],
);

/**
 * The local update log: one row per Loro update, serving as both the history
 * tail (restore = checkpoint + tail) and the outbound write queue.
 *
 * Every locally authored update is stored once. While it waits for sync it
 * carries an `updateId` (the id submitted to the server) and the version-vector
 * metadata the submission needs; settlement clears them, leaving the row as
 * ordinary tail history until compaction folds it into a checkpoint.
 *
 * Columns:
 * - `id`: Row id; tail compaction deletes by it.
 * - `appKind`, `localId`: Document scope matching `documents`.
 * - `updateData`: Serialized Loro update payload.
 * - `origin`: "local" (authored on this device) or "remote" (decrypted
 *   pulled update) for tail rows. Restores use it to advance the
 *   outgoing-delta marker across remote rows — their ops are already
 *   server-side — while a local row left behind by a crash stays below the
 *   marker so the next edit re-derives and sends it. "outbox" marks a queued
 *   update with no tail role (container metadata, whose content is its
 *   checkpoint, and full-state re-uploads after a remote reset); restores and
 *   compaction never see it and settlement deletes it.
 * - `createdAt`: Insertion timestamp; with `rowid`, deterministic replay order.
 * - `updateId`: Present exactly while the row is queued for sync; rekeyed
 *   after a lost acknowledgement poisons the submitted id.
 * - `partialStartVersionVector` / `partialEndVersionVector`: Version vectors
 *   around a queued partial update.
 * - `sourceVersionVector`: Present on a queued rotation baseline checkpoint.
 * - `rekeyCount`: Durable bound on rekeys of a queued row.
 *
 * Invariant: compaction never deletes a queued row, so a checkpoint can cover
 * a queued update's operations without removing it from the queue.
 */
export const documentHistoryUpdates = sqliteTable(
  "document_history_updates",
  {
    id: text("id"),
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    updateData: text("update_data").notNull(),
    origin: text("origin").notNull(),
    createdAt: text("created_at").notNull(),
    updateId: text("update_id"),
    partialStartVersionVector: text("partial_start_version_vector"),
    partialEndVersionVector: text("partial_end_version_vector"),
    sourceVersionVector: text("source_version_vector"),
    rekeyCount: integer("rekey_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("document_history_updates_scope_created_idx").on(
      table.appKind,
      table.localId,
      table.createdAt,
    ),
    uniqueIndex("document_history_updates_update_id_idx")
      .on(table.updateId)
      .where(sql`${table.updateId} IS NOT NULL`),
    // Queued rows only: pending counts and pending loads skip settled history.
    index("document_history_updates_queued_scope_idx")
      .on(table.appKind, table.localId, table.createdAt)
      .where(sql`${table.updateId} IS NOT NULL`),
  ],
);

export const documentTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(documents),
    requiredColumns: [
      "pull_continuation",
      "recovery_generation",
      "recovery_document_id",
      "sync_failure_status",
      "sync_failure_message",
      "sync_failure_attempted_at",
    ],
  },
  defineSqlTableSchema(documentHistoryCheckpoints),
  {
    ...defineSqlTableSchema(documentHistoryUpdates),
    requiredColumns: ["update_id"],
  },
];
