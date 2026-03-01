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

export interface VfsBlobAbandonRequest {
  stagingId: string;
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
    encryption?: VfsBlobStageEncryptionMetadata | undefined;
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
  checkpoint?: VfsBlobStageUploadCheckpoint | undefined;
}

export interface VfsBlobAttachQueueOperation {
  operationId: string;
  kind: 'attach';
  payload: {
    stagingId: string;
    itemId: string;
    relationKind: VfsBlobRelationKind;
    consistency?: VfsBlobAttachConsistency | undefined;
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
  retryPolicy?: Partial<VfsBlobNetworkRetryPolicy>;
  retrySleep?: (delayMs: number) => Promise<void> | void;
  onRetry?: (event: VfsBlobNetworkRetryEvent) => Promise<void> | void;
  onOperationResult?:
    | ((event: VfsBlobNetworkOperationResultEvent) => Promise<void> | void)
    | undefined;
}

export interface VfsBlobNetworkRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
}

export type VfsBlobNetworkOperationKind = VfsBlobNetworkOperation['kind'];

export type VfsBlobFailureClass = 'http_status' | 'network' | 'unknown';

export interface VfsBlobNetworkRetryEvent {
  operationId: string;
  operationKind: VfsBlobNetworkOperationKind;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  failureClass: VfsBlobFailureClass;
  statusCode?: number | undefined;
}

export interface VfsBlobNetworkOperationResultEvent {
  operationId: string;
  operationKind: VfsBlobNetworkOperationKind;
  attempts: number;
  retryCount: number;
  success: boolean;
  failureClass?: VfsBlobFailureClass | undefined;
  statusCode?: number | undefined;
  retryable?: boolean | undefined;
}
