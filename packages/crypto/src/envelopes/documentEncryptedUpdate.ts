import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { CONTENT_RECORD_ENCRYPTION_SUITE } from "../keying/writeHeader/writeHeaderTypes";
import { assertAesGcmIv } from "../primitives/symmetric";

export const DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT =
  "tearleads.document.loro-update";

const DOCUMENT_ENCRYPTED_UPDATE_KEYS: ReadonlySet<string> = new Set([
  "ciphertext",
  "contentKeyCommitment",
  "contentKeyEpoch",
  "contentRecordId",
  "encryptionSuite",
  "format",
  "iv",
  "metadataHash",
  "nonceDomainHash",
  "version",
]);

const LABEL = "Document encrypted update";

export interface ParsedDocumentEncryptedUpdate {
  ciphertext: Uint8Array;
  /**
   * The writer's content-key commitment for this document and epoch: the
   * envelope is signed through the write header's `ciphertextHash`, so a
   * reader holding the key it names can blame the writer for AES-GCM.
   */
  contentKeyCommitment: string;
  contentKeyEpoch: number;
  contentRecordId: string;
  iv: Uint8Array;
  metadataHash: string;
  nonceDomainHash: string;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${LABEL}.${key} must be a non-empty string`);
  }
  return value;
}

function readLowerHex64(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${LABEL}.${key} must be 64 lowercase hex characters`);
  }
  return value;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${LABEL}.${key} must be a positive integer`);
  }
  return value;
}

function assertOnlyEnvelopeKeys(record: Record<string, unknown>): void {
  const unexpectedKeys = Object.keys(record).filter(
    (key) => !DOCUMENT_ENCRYPTED_UPDATE_KEYS.has(key),
  );
  if (unexpectedKeys.length === 0) return;
  const named = unexpectedKeys
    .slice(0, 3)
    .map((key) => JSON.stringify(key.slice(0, 32)))
    .join(",");
  const remaining = unexpectedKeys.length - 3;
  throw new Error(
    `${LABEL} has unexpected keys: ${named}${remaining > 0 ? ` and ${remaining} more` : ""}`,
  );
}

/**
 * Parses a document update's encrypted envelope. The writer signs only its
 * hash, so the API runs this same parser before storing an update: an
 * envelope every reader would refuse is refused once, at the write.
 */
export function parseDocumentEncryptedUpdate(
  encryptedData: string,
): ParsedDocumentEncryptedUpdate {
  let value: unknown;
  try {
    value = JSON.parse(encryptedData);
  } catch {
    throw new Error(`${LABEL} is invalid JSON`);
  }
  if (!isPlainObject(value)) {
    throw new Error(`${LABEL} must be an object`);
  }
  const record = value;
  assertOnlyEnvelopeKeys(record);
  if (readString(record, "format") !== DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT) {
    throw new Error(`${LABEL} format is invalid`);
  }
  const version = readPositiveInteger(record, "version");
  if (version !== 1) {
    throw new Error(`${LABEL} version ${version} is invalid; expected 1`);
  }
  if (
    readString(record, "encryptionSuite") !== CONTENT_RECORD_ENCRYPTION_SUITE
  ) {
    throw new Error(`${LABEL} suite is invalid`);
  }
  const iv = base64ToBytes(readString(record, "iv"));
  assertAesGcmIv(iv, `${LABEL} IV is invalid`);
  return {
    ciphertext: base64ToBytes(readString(record, "ciphertext")),
    contentKeyCommitment: readLowerHex64(record, "contentKeyCommitment"),
    contentKeyEpoch: readPositiveInteger(record, "contentKeyEpoch"),
    contentRecordId: readString(record, "contentRecordId"),
    iv,
    metadataHash: readString(record, "metadataHash"),
    nonceDomainHash: readString(record, "nonceDomainHash"),
  };
}
