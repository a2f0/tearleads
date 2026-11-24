import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentContentRecordCiphertextHash,
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  signWriteHeader,
  type UnsignedWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";

/**
 * Stands for the commitment of a route test's content key. The API compares
 * commitments and never derives one, so every fixture bundle and envelope
 * can name this one value at every epoch.
 */
export const CONTENT_KEY_COMMITMENT_FIXTURE = "c".repeat(64);

/**
 * A document update envelope that matches its write header but carries
 * placeholder ciphertext: the API checks the envelope's bindings, never its
 * plaintext, so a route test needs no content key.
 */
export function documentEnvelopeFixture(input: {
  readonly contentKeyCommitment?: string | undefined;
  readonly contentKeyEpoch: number;
  readonly contentRecordId: string;
  readonly label: string;
  readonly metadataHash: string;
  readonly nonceDomainHash: string;
}): string {
  return JSON.stringify({
    format: DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
    version: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyCommitment:
      input.contentKeyCommitment ?? CONTENT_KEY_COMMITMENT_FIXTURE,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId: input.contentRecordId,
    nonceDomainHash: input.nonceDomainHash,
    metadataHash: input.metadataHash,
    iv: bytesToBase64(new Uint8Array(12)),
    ciphertext: bytesToBase64(new TextEncoder().encode(input.label)),
  });
}

/**
 * Signs a document write header over a placeholder envelope built from the
 * header's own bindings, as a client does over its real ciphertext.
 */
export async function signWithDocumentEnvelope(
  label: string,
  header: Omit<UnsignedWriteHeader, "ciphertextHash">,
  signingPrivateKey: Uint8Array,
  contentKeyCommitment?: string | undefined,
): Promise<{ encryptedData: string; writeHeader: WriteHeader }> {
  const encryptedData = documentEnvelopeFixture({
    contentKeyCommitment,
    contentKeyEpoch: header.contentKeyEpoch,
    contentRecordId: header.contentRecordId,
    label,
    metadataHash: header.metadataHash,
    nonceDomainHash: header.nonceDomainHash,
  });
  const writeHeader = await signWriteHeader(
    {
      ...header,
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
    },
    signingPrivateKey,
  );
  return { encryptedData, writeHeader };
}
