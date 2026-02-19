import type { Base64, EncryptedManifest, ItemId } from './types';

export interface UploadEncryptedBlobInput {
  itemId: ItemId;
  blobId: string;
  contentType?: string;
  stream: ReadableStream<Uint8Array>;
}

export interface EncryptCrdtOpInput {
  itemId: ItemId;
  opType: string;
  opPayload: unknown;
}

export interface EncryptCrdtOpResult {
  encryptedOp: Base64;
  opNonce: Base64;
  opAad: Base64;
  keyEpoch: number;
  opSignature: Base64;
}

export interface VfsSecureWritePipeline {
  uploadEncryptedBlob(input: UploadEncryptedBlobInput): Promise<EncryptedManifest>;
  encryptCrdtOp(input: EncryptCrdtOpInput): Promise<EncryptCrdtOpResult>;
}

export interface QueueEncryptedCrdtOpAndPersistInput {
  itemId: ItemId;
  opType: string;
  opPayload: unknown;
}

export interface StageAttachEncryptedBlobAndPersistInput {
  itemId: ItemId;
  blobId: string;
  contentType?: string;
  stream: ReadableStream<Uint8Array>;
  expiresAt: string;
}

export interface StageAttachEncryptedBlobAndPersistResult {
  stagingId: string;
  manifest: EncryptedManifest;
}

export interface VfsSecureOrchestratorFacade {
  queueEncryptedCrdtOpAndPersist(
    input: QueueEncryptedCrdtOpAndPersistInput
  ): Promise<void>;
  stageAttachEncryptedBlobAndPersist(
    input: StageAttachEncryptedBlobAndPersistInput
  ): Promise<StageAttachEncryptedBlobAndPersistResult>;
}
