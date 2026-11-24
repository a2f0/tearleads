import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordMetadataHash,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT } from "../../../src/data/documents/shared/types";

/**
 * An envelope over placeholder ciphertext, for checks that never decrypt. It
 * commits to a placeholder key unless the caller names a commitment.
 */
export async function createDocumentEncryptedUpdateFixture(input: {
  contentKeyCommitment?: string | undefined;
  contentKeyEpoch: number;
  dependencyVersionVector: string;
  documentId: string;
  id: string;
  organizationId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
}): Promise<{
  encryptedData: string;
  metadataHash: string;
  nonceDomainHash: string;
}> {
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.id,
  });
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    dependencyVersionVector: input.dependencyVersionVector,
    documentId: input.documentId,
    partialEndVersionVector: input.partialEndVersionVector,
    partialStartVersionVector: input.partialStartVersionVector,
    plaintextHash: input.plaintextHash,
    updateId: input.id,
  });
  const encryptedData = serializeKeyingCanonicalJson({
    format: DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
    version: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyCommitment: input.contentKeyCommitment ?? "c".repeat(64),
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId: input.id,
    nonceDomainHash,
    metadataHash,
    iv: bytesToBase64(new Uint8Array(12)),
    ciphertext: bytesToBase64(new TextEncoder().encode(`fixture:${input.id}`)),
  });
  return { encryptedData, metadataHash, nonceDomainHash };
}
