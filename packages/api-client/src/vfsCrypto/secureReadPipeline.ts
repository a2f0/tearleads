import type { UploadEncryptedBlobChunk } from './secureWritePipeline';
import type { EncryptedManifest } from './types';

export interface DownloadEncryptedBlobInput {
  manifest: EncryptedManifest;
  chunks: UploadEncryptedBlobChunk[];
}

export interface VfsSecureReadPipeline {
  decryptEncryptedBlob(input: DownloadEncryptedBlobInput): Promise<Uint8Array>;
}
