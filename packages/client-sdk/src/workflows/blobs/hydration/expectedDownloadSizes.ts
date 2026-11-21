import {
  BLOB_CHUNK_SIZE_BYTES,
  BLOB_ENVELOPE_PREFIX_BYTES,
  blobContentMetadataHash,
  computeBlobChunkCount,
  computeBlobEncryptedByteLength,
  MAX_BLOB_ENVELOPE_HEADER_BYTES,
} from "@tearleads/crypto";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import type { DocumentAttachment } from "../../../data/documents";

/** Trusted sizes supplied by a host verifying a known set of files. */
export interface ExpectedDownloadSizes {
  documentId: string;
  sizesBySlot: ReadonlyMap<string, number>;
  onVerifiedBinding?: ((binding: BlobAttachmentSummary) => void) | undefined;
  /** Bounds every read of the verification, including the writer projection. */
  signal: AbortSignal;
}

export async function expectedEncryptedDownloadLimits(
  documentId: string,
  expected: ExpectedDownloadSizes | undefined,
  targets: readonly {
    attachment: DocumentAttachment;
    binding: BlobAttachmentSummary;
  }[],
) {
  if (!expected) return undefined;
  const limits = new Map<string, number>();
  for (const { attachment, binding } of targets) {
    const byteLength = expected.sizesBySlot.get(attachment.slotId);
    if (
      documentId !== expected.documentId ||
      byteLength === undefined ||
      attachment.byteLength !== byteLength
    )
      throw new Error(
        `Unexpected attachment size or slot: ${attachment.slotId}`,
      );
    const chunkSize = BLOB_CHUNK_SIZE_BYTES;
    const chunkCount = computeBlobChunkCount(byteLength, chunkSize);
    const hash = await blobContentMetadataHash({
      blobId: binding.blobId,
      byteLength,
      chunkCount,
      chunkSize,
      contentKeyEpoch: binding.contentKeyBundle.contentKeyEpoch,
    });
    const { metadataHash } = binding.writeHeader;
    if (metadataHash !== hash)
      throw new Error(`Unexpected bound attachment size: ${attachment.slotId}`);
    const limit = computeBlobEncryptedByteLength({
      plaintextByteLength: byteLength,
      chunkCount,
      headerByteLength:
        BLOB_ENVELOPE_PREFIX_BYTES + MAX_BLOB_ENVELOPE_HEADER_BYTES,
    });
    const existing = limits.get(binding.blobId);
    if (existing !== undefined && existing !== limit)
      throw new Error("Conflicting attachment sizes for the same blob");
    limits.set(binding.blobId, limit);
  }
  return limits;
}
