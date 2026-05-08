export interface DocumentRecord {
  id: string;
  documentId: string | null;
  loroSnapshot: string;
  accessEpoch: number;
  accessStateHash?: string | null;
  lastCommitLsn?: string | null;
  contentKeyBundle?: string | null;
  documentKekTargets?: string | null;
  documentManifestBundle?: string | null;
}

export interface PendingUpdateFields {
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string | null;
}

export interface PendingUpdateRecord extends PendingUpdateFields {
  id: string;
}

export interface DocumentScope {
  appKind: string;
  localId: string;
}

export interface SelectedDocumentRecordRow {
  id: string;
  documentId: string | null;
  loroSnapshot: string;
  accessEpoch: number;
  accessStateHash: string | null;
  lastCommitLsn: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
}

export interface SelectedPendingUpdateRow {
  id: string | null;
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector: string | null;
}
