import type { VfsBlobFailureClass } from './vfsBlobNetworkFlusherTypes';

export interface VfsBlobDownloadOperation {
  operationId: string;
  blobId: string;
  itemId: string;
  sizeBytes: number;
}

export interface VfsBlobDownloadFlusherPersistedState {
  pendingDownloads: VfsBlobDownloadOperation[];
}

export interface VfsBlobDownloadResult {
  processedDownloads: number;
  pendingDownloads: number;
  skippedAlreadyCached: number;
}

export interface VfsBlobDownloadRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
}

export interface VfsBlobDownloadResultEvent {
  operationId: string;
  blobId: string;
  success: boolean;
  skipped: boolean;
  attempts: number;
  failureClass?: VfsBlobFailureClass | undefined;
  statusCode?: number | undefined;
}

export type VfsBlobDownloadPersistStateCallback = (
  state: VfsBlobDownloadFlusherPersistedState
) => Promise<void> | void;

export type VfsBlobDownloadLoadStateCallback = () =>
  | Promise<VfsBlobDownloadFlusherPersistedState | null>
  | VfsBlobDownloadFlusherPersistedState
  | null;
