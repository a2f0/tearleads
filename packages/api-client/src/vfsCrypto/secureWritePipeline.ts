import type { VfsCrdtOpType } from '@tearleads/vfs-sync/vfs';
import type { Base64, EncryptedManifest, ItemId } from './types';

export interface UploadEncryptedBlobInput {
  itemId: ItemId;
  blobId: string;
  contentType?: string | undefined;
  stream: ReadableStream<Uint8Array>;
}

export interface EncryptCrdtOpInput {
  itemId: ItemId;
  opType: VfsCrdtOpType;
  opPayload: unknown;
}

export interface EncryptCrdtOpResult {
  encryptedOp: Base64;
  opNonce: Base64;
  opAad: Base64;
  keyEpoch: number;
  opSignature: Base64;
}

export interface UploadEncryptedBlobChunk {
  chunkIndex: number;
  isFinal: boolean;
  nonce: Base64;
  aadHash: Base64;
  ciphertextBase64: Base64;
  plaintextLength: number;
  ciphertextLength: number;
}

export interface UploadEncryptedBlobResult {
  manifest: EncryptedManifest;
  uploadId?: string | undefined;
  chunks?: UploadEncryptedBlobChunk[] | undefined;
}

export interface VfsSecureWritePipeline {
  uploadEncryptedBlob(
    input: UploadEncryptedBlobInput
  ): Promise<UploadEncryptedBlobResult>;
  encryptCrdtOp(input: EncryptCrdtOpInput): Promise<EncryptCrdtOpResult>;
}

export interface QueueEncryptedCrdtOpAndPersistInput {
  itemId: ItemId;
  opType: VfsCrdtOpType;
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
