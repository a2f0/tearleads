import type { ContainerAccessLevel } from "@tearleads/crypto";
import type { DocumentSyncPullContinuation } from "../../../documents/shared/sync/pullContinuation";

export interface DocumentRecord {
  id: string;
  documentId: string | null;
  /**
   * Durable fence advanced by an atomic raw-history recovery install. Writers
   * capture this before waiting for the mutation queue and must refuse to
   * publish when recovery advanced it first.
   */
  recoveryGeneration?: number;
  /** Former server id reserved for deterministic post-purge recreation. */
  recoveryDocumentId?: string | null;
  /**
   * Encoded end version vector of the persisted content frontier. Content
   * itself lives in the durable history (checkpoint + tail); this column
   * exists so priming and coverage predicates can compare versions from a
   * narrow indexed column. Empty string means "never hydrated".
   */
  snapshotEndVersion: string;
  accessEpoch: number;
  accessStateHash?: string | null;
  effectiveAccessLevel?: ContainerAccessLevel | null;
  lastCommitLsn?: string | null;
  contentKeyBundle?: string | null;
  documentKekTargets?: string | null;
  documentManifestBundle?: string | null;
  pendingBaseVersion?: string | null;
  /**
   * Salt of the writer peer a peer rebase moved this record to. Absent while
   * the record writes on its first peer. Only the rebase install writes the
   * column, so an ordinary save never clears it.
   */
  peerSalt?: string;
  pullContinuation?: DocumentSyncPullContinuation | null;
  /**
   * The durable continuation column was non-null but could not be decoded.
   * Keep forcing a page-one pull until a successful settlement replaces the
   * malformed value; ordinary local saves must preserve that recovery signal.
   */
  pullContinuationRecoveryRequired?: true;
}

export interface PendingUpdateFields {
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string | null;
  /**
   * The version this device knew the server had committed when it queued the
   * update below it: a relay after a stale recreation sends committed
   * operations again. Absent on every other update. A later peer refusal is
   * judged against it, because the queue's start no longer says where the
   * unsent operations begin.
   */
  committedVersionVector?: string | null;
}

/**
 * Who owns a queued row: `local` rows are locally authored history-tail
 * entries; `outbox` rows (full-state re-uploads, container metadata) have no
 * tail role.
 */
export type PendingUpdateOrigin = "local" | "outbox";

export interface PendingUpdateRecord extends PendingUpdateFields {
  id: string;
  /**
   * Times this row was assigned a fresh id by lost-ack conflict recovery.
   * Persisted so the bound survives restarts; absent means zero (rows from
   * simple test doubles).
   */
  rekeyCount?: number | undefined;
}

/** A row as the durable outgoing queue lists it, with its owner. */
export interface QueuedPendingUpdateRecord extends PendingUpdateRecord {
  origin: PendingUpdateOrigin;
}

export interface DocumentScope {
  appKind: string;
  localId: string;
}

export interface SelectedDocumentRecordRow {
  id: string;
  documentId: string | null;
  recoveryGeneration: number;
  recoveryDocumentId: string | null;
  snapshotEndVersion: string;
  accessEpoch: number;
  accessStateHash: string | null;
  effectiveAccessLevel: string | null;
  lastCommitLsn: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
  pendingBaseVersion: string | null;
  peerSalt: string | null;
  pullContinuation: string | null;
}

export interface SelectedPendingUpdateRow {
  id: string | null;
  origin: string;
  updateData: string;
  partialStartVersionVector: string | null;
  partialEndVersionVector: string | null;
  sourceVersionVector: string | null;
  committedVersionVector: string | null;
  rekeyCount: number;
}
