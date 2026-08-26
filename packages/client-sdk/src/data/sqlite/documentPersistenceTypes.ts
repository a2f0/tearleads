import type { ContainerAccessLevel } from "@symcrypt/crypto";
import type { DocumentSyncPullContinuation } from "../documents/shared/pullContinuation";

export interface DocumentRecord {
  id: string;
  documentId: string | null;
  /**
   * Durable fence advanced by an atomic raw-history recovery install. Writers
   * capture this before waiting for the mutation queue and must refuse to
   * publish when recovery advanced it first. Missing means the initial zero.
   */
  recoveryGeneration?: number;
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
}

export interface PendingUpdateRecord extends PendingUpdateFields {
  id: string;
  /**
   * Times this row was assigned a fresh id by lost-ack conflict recovery.
   * Persisted so the bound survives restarts; absent means zero (rows from
   * simple test doubles).
   */
  rekeyCount?: number | undefined;
}

export interface DocumentScope {
  appKind: string;
  localId: string;
}

export interface SelectedDocumentRecordRow {
  id: string;
  documentId: string | null;
  recoveryGeneration: number;
  snapshotEndVersion: string;
  accessEpoch: number;
  accessStateHash: string | null;
  effectiveAccessLevel: string | null;
  lastCommitLsn: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
  pendingBaseVersion: string | null;
  pullContinuation: string | null;
}

export interface SelectedPendingUpdateRow {
  id: string | null;
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector: string | null;
  rekeyCount: number;
}
