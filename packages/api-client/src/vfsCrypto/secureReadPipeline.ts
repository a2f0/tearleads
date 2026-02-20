import type { EncryptedManifest } from './types';
import type { UploadEncryptedBlobChunk } from './secureWritePipeline';

export interface DownloadEncryptedBlobInput {
  manifest: EncryptedManifest;
  chunks: UploadEncryptedBlobChunk[];
}

export interface VfsSecureReadPipeline {
  decryptEncryptedBlob(input: DownloadEncryptedBlobInput): Promise<Uint8Array>;
}
