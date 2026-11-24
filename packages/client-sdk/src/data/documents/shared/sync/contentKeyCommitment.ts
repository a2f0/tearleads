import { bytesToHex, serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { importContentKeyMaterial } from "../contentRecordKeys";
import { asWebCryptoBytes } from "../readers";
import { DOCUMENT_CONTENT_RECORD_HKDF_SALT, TEXT_ENCODER } from "../types";

const DOCUMENT_CONTENT_KEY_COMMITMENT_INFO_DOMAIN =
  "tearleads.document.content-key-commitment";

/**
 * Commits to a document's content key for one epoch without revealing it: an
 * HKDF output in its own domain, so it derives no record or plaintext-hash
 * key. Two keys with one commitment would be a SHA-256 collision, so a reader
 * whose key matches the commitment a writer signed holds the writer's key,
 * and an AES-GCM failure under it is the writer's fault, not the reader's.
 */
export async function deriveDocumentContentKeyCommitment(input: {
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
}): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    asWebCryptoBytes(input.contentKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: DOCUMENT_CONTENT_RECORD_HKDF_SALT,
      info: TEXT_ENCODER.encode(
        serializeKeyingCanonicalJson({
          domain: DOCUMENT_CONTENT_KEY_COMMITMENT_INFO_DOMAIN,
          payload: {
            version: 1,
            objectKind: "document",
            objectId: input.documentId,
            contentKeyEpoch: input.contentKeyEpoch,
          },
        }),
      ),
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** A content key ready to encrypt or decrypt, with the commitment it signs. */
export interface DocumentContentKey {
  readonly commitment: string;
  readonly material: CryptoKey;
}

export async function openDocumentContentKey(input: {
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
}): Promise<DocumentContentKey> {
  const [commitment, material] = await Promise.all([
    deriveDocumentContentKeyCommitment(input),
    importContentKeyMaterial(input.contentKey),
  ]);
  return { commitment, material };
}

/** Raised when an unwrapped key is not the one its epoch committed to. */
export class DocumentContentKeyCommitmentError extends Error {
  constructor(contentKeyEpoch: number) {
    super(
      `Document content key for epoch ${contentKeyEpoch} does not match its epoch's commitment`,
    );
    this.name = "DocumentContentKeyCommitmentError";
  }
}

/**
 * Throws unless `contentKey` is the key `contentKeyCommitment` names. The
 * honest cause of a mismatch is a wrap that is not the epoch's: this device
 * cannot read the epoch until it is served the right one, and no verdict
 * reached under its key would be the writer's.
 */
export async function assertDocumentContentKeyCommitment(input: {
  readonly contentKey: Uint8Array;
  readonly contentKeyCommitment: string;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
}): Promise<void> {
  if (
    (await deriveDocumentContentKeyCommitment(input)) !==
    input.contentKeyCommitment
  ) {
    throw new DocumentContentKeyCommitmentError(input.contentKeyEpoch);
  }
}
