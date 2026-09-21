import { deriveBlobChunkIv } from "@tearleads/crypto";
import type { BlobBytes } from "../../data/blobContracts";
import { contentRecordAdditionalDataBytes } from "../../data/documents/blob/shared/crypto";
import type {
  BlobEncryptedBytesRecord,
  BlobEncryptedChunk,
} from "../../data/documents/blob/shared/types";
import { asWebCryptoBytes } from "../../data/documents/shared/readers";

interface BlobChunkDecryption {
  encrypted: BlobEncryptedBytesRecord;
  expectedBlobId: string;
  organizationId: string;
  recordKey: CryptoKey;
}

export async function decryptBlobChunk(
  input: BlobChunkDecryption & {
    chunk: BlobEncryptedChunk;
  },
): Promise<BlobBytes> {
  const { encrypted, expectedBlobId, organizationId, recordKey, chunk } = input;
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: deriveBlobChunkIv(encrypted.iv, chunk.index),
        additionalData: contentRecordAdditionalDataBytes({
          blobId: expectedBlobId,
          chunkCount: encrypted.chunkCount,
          chunkIndex: chunk.index,
          chunkPlaintextByteLength: chunk.plaintextByteLength,
          chunkSize: encrypted.chunkSize,
          contentKeyEpoch: encrypted.contentKeyEpoch,
          contentRecordId: encrypted.contentRecordId,
          metadataHash: encrypted.metadataHash,
          nonceDomainHash: encrypted.nonceDomainHash,
          organizationId,
          plaintextByteLength: encrypted.byteLength,
        }),
      },
      recordKey,
      asWebCryptoBytes(chunk.ciphertext),
    ),
  );
  if (plaintext.byteLength !== chunk.plaintextByteLength)
    throw new Error("Blob decrypted chunk byte length mismatch");
  return plaintext;
}

export async function decryptBlobChunks(
  input: BlobChunkDecryption,
): Promise<BlobBytes> {
  const decrypted = new Uint8Array(input.encrypted.byteLength);
  for (const chunk of input.encrypted.chunks) {
    decrypted.set(
      await decryptBlobChunk({ ...input, chunk }),
      chunk.index * input.encrypted.chunkSize,
    );
  }
  return decrypted;
}
