import type {
  VfsCrdtLastReconciledWriteIds,
  VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';

export type VfsBlobRelationKind =
  | 'file'
  | 'emailAttachment'
  | 'photo'
  | 'other';

export interface VfsBlobStageRequest {
  stagingId?: string;
  blobId: string;
  expiresAt: string;
  encryption?: VfsBlobStageEncryptionMetadata;
}

export interface VfsBlobStageResponse {
  stagingId: string;
  blobId: string;
  status: 'staged';
  stagedAt: string;
  expiresAt: string;
}

export interface VfsBlobAttachConsistency {
  clientId: string;
  requiredCursor: VfsSyncCursor;
  requiredLastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
}

export interface VfsBlobAttachRequest {
  stagingId: string;
  itemId: string;
  relationKind?: VfsBlobRelationKind;
  consistency?: VfsBlobAttachConsistency;
}

export interface VfsBlobAttachResponse {
  attached: true;
  stagingId: string;
  blobId: string;
  itemId: string;
  relationKind: VfsBlobRelationKind;
  refId: string;
  attachedAt: string;
}

export interface VfsBlobAbandonRequest {
  stagingId: string;
}

export interface VfsBlobAbandonResponse {
  abandoned: true;
  stagingId: string;
  status: 'abandoned';
}

export interface VfsBlobChunkUploadRequest {
  stagingId: string;
  uploadId: string;
  chunkIndex: number;
  isFinal: boolean;
  nonce: string;
  aadHash: string;
  ciphertextBase64: string;
  plaintextLength: number;
  ciphertextLength: number;
}

export interface VfsBlobManifestCommitRequest {
  stagingId: string;
  uploadId: string;
  keyEpoch: number;
  manifestHash: string;
  manifestSignature: string;
  chunkCount: number;
  totalPlaintextBytes: number;
  totalCiphertextBytes: number;
}

export interface VfsBlobStageQueueOperation {
  operationId: string;
  kind: 'stage';
  payload: {
    stagingId: string;
    blobId: string;
    expiresAt: string;
    encryption?: VfsBlobStageEncryptionMetadata;
  };
}

export interface VfsBlobStageUploadCheckpoint {
  uploadId: string;
  nextChunkIndex: number;
}

export interface VfsBlobStageEncryptionMetadata {
  algorithm: string;
  keyEpoch: number;
  manifestHash: string;
  chunkCount: number;
  chunkSizeBytes: number;
  plaintextSizeBytes: number;
  ciphertextSizeBytes: number;
  checkpoint?: VfsBlobStageUploadCheckpoint;
}

export interface VfsBlobAttachQueueOperation {
  operationId: string;
  kind: 'attach';
  payload: {
    stagingId: string;
    itemId: string;
    relationKind: VfsBlobRelationKind;
    consistency?: VfsBlobAttachConsistency;
  };
}

export interface VfsBlobAbandonQueueOperation {
  operationId: string;
  kind: 'abandon';
  payload: {
    stagingId: string;
  };
}

export interface VfsBlobChunkQueueOperation {
  operationId: string;
  kind: 'chunk';
  payload: {
    stagingId: string;
    uploadId: string;
    chunkIndex: number;
    isFinal: boolean;
    nonce: string;
    aadHash: string;
    ciphertextBase64: string;
    plaintextLength: number;
    ciphertextLength: number;
  };
}

export interface VfsBlobCommitQueueOperation {
  operationId: string;
  kind: 'commit';
  payload: {
    stagingId: string;
    uploadId: string;
    keyEpoch: number;
    manifestHash: string;
    manifestSignature: string;
    chunkCount: number;
    totalPlaintextBytes: number;
    totalCiphertextBytes: number;
  };
}

export type VfsBlobNetworkOperation =
  | VfsBlobStageQueueOperation
  | VfsBlobAttachQueueOperation
  | VfsBlobAbandonQueueOperation
  | VfsBlobChunkQueueOperation
  | VfsBlobCommitQueueOperation;

export interface VfsBlobNetworkFlusherPersistedState {
  pendingOperations: VfsBlobNetworkOperation[];
}

export interface VfsBlobNetworkFlusherFlushResult {
  processedOperations: number;
  pendingOperations: number;
}

export type PersistStateCallback = (
  state: VfsBlobNetworkFlusherPersistedState
) => Promise<void> | void;

export type LoadStateCallback = () =>
  | Promise<VfsBlobNetworkFlusherPersistedState | null>
  | VfsBlobNetworkFlusherPersistedState
  | null;

export interface VfsBlobNetworkFlusherOptions {
  baseUrl?: string;
  apiPrefix?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  saveState?: PersistStateCallback;
  loadState?: LoadStateCallback;
}
