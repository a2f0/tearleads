import { AES_GCM_TAG_BYTES, bytesToHex } from "@tearleads/crypto";
import { createBlobEnvelopeStream } from "../../data/documents/blob/shared/blobEnvelopeStream";
import { blobChunkPlaintextByteLength } from "../../data/documents/blob/shared/blobEnvelopeV2";
import type {
  BlobEncryptedBytesRecord,
  DecryptDocumentAttachmentBlobInput,
} from "../../data/documents/blob/shared/types";
import {
  assertEqualBytes,
  readWriteHeader,
} from "../../data/documents/shared/readers";
import type { DocumentLinkSetMutationApi } from "../../data/documents/shared/types";
import { createAttachmentProofReader } from "./attachmentDecryptor";
import { decryptBlobChunk } from "./blobChunkDecryption";
import { prepareDocumentAttachmentBlobDecryption } from "./decrypt";

type AttachmentKeyInput = Omit<
  DecryptDocumentAttachmentBlobInput,
  "encryptedBytes"
>;
type VerifiedKey = {
  ciphertextHash: string;
  encrypted: BlobEncryptedBytesRecord;
  contentKey: Uint8Array;
};
type ProofReader = ReturnType<typeof createProofReader>;

const createProofReader = (
  api: DocumentLinkSetMutationApi,
  documentId: string,
) =>
  createAttachmentProofReader(
    api,
    documentId,
    prepareDocumentAttachmentBlobDecryption,
  );

async function authenticateAttachmentKey(
  api: DocumentLinkSetMutationApi,
  input: AttachmentKeyInput,
  readProof: ProofReader,
): Promise<VerifiedKey> {
  const blob = await api.getBlobBytes(input.binding.blobId);
  if (!blob)
    throw new Error("Attachment ciphertext is unavailable for relinking");
  const body = new Response(blob.encryptedBytes).body;
  if (!body) throw new Error("Attachment ciphertext stream is unavailable");
  const source = createBlobEnvelopeStream(body);
  try {
    const encrypted = await source.readHeader();
    // A missing citation can refresh the proof before consuming ciphertext.
    const context = await readProof({ ...input, encrypted });
    for (let index = 0; index < encrypted.chunkCount; index++) {
      const plaintextByteLength = blobChunkPlaintextByteLength({
        chunkCount: encrypted.chunkCount,
        chunkIndex: index,
        chunkSize: encrypted.chunkSize,
        plaintextByteLength: encrypted.byteLength,
      });
      const ciphertext = await source.read(
        plaintextByteLength + AES_GCM_TAG_BYTES,
      );
      await decryptBlobChunk({
        ...context,
        encrypted,
        expectedBlobId: input.binding.blobId,
        chunk: { ciphertext, index, plaintextByteLength },
      });
    }
    const header = readWriteHeader(
      input.binding.writeHeader,
      "Attachment blob write header",
    );
    if (bytesToHex(await source.finish()) !== header.ciphertextHash)
      throw new Error("Attachment blob write header does not match ciphertext");
    return {
      encrypted,
      contentKey: context.contentKey,
      ciphertextHash: header.ciphertextHash,
    };
  } finally {
    await source.close();
  }
}

/** Shared blobs retain only authenticated keys and metadata, never their bytes. */
export function createAttachmentKeyAuthenticator(
  api: DocumentLinkSetMutationApi,
  documentId: string,
) {
  const readProof = createProofReader(api, documentId);
  const authenticated = new Map<string, Promise<VerifiedKey>>();
  return async (input: AttachmentKeyInput): Promise<Uint8Array> => {
    const existing = authenticated.get(input.binding.blobId);
    if (!existing) {
      const pending = authenticateAttachmentKey(api, input, readProof);
      authenticated.set(input.binding.blobId, pending);
      return (await pending).contentKey;
    }
    const cached = await existing;
    const context = await readProof({ ...input, encrypted: cached.encrypted });
    if (
      readWriteHeader(input.binding.writeHeader, "Attachment blob write header")
        .ciphertextHash !== cached.ciphertextHash
    )
      throw new Error("Attachment blob write header does not match ciphertext");
    assertEqualBytes(
      context.contentKey,
      cached.contentKey,
      "Attachment bindings contain conflicting blob keys",
    );
    return cached.contentKey;
  };
}
