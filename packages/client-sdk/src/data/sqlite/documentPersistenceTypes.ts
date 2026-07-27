import type { ContainerAccessLevel } from "@tearleads/crypto";

export interface DocumentRecord {
  id: string;
  documentId: string | null;
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
  snapshotEndVersion: string;
  accessEpoch: number;
  accessStateHash: string | null;
  effectiveAccessLevel: string | null;
  lastCommitLsn: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
  pendingBaseVersion: string | null;
}

export interface SelectedPendingUpdateRow {
  id: string | null;
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector: string | null;
  rekeyCount: number;
}
