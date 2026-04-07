import { parseEnvelope } from "@tearleads/loro";
import { uniqueSortedStrings } from "./array";

const ENCRYPTED_BLOB_FORMAT = "tearleads.blob.v1";

interface SerializedBlobRecipientEntry {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

interface SerializedEncryptedBlobEnvelope {
  format: typeof ENCRYPTED_BLOB_FORMAT;
  iv: string;
  ciphertext: string;
  recipients: SerializedBlobRecipientEntry[];
}

export interface PersistedRecipientEnvelopeEntry {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

function isSerializedBlobRecipientEntry(
  value: unknown,
): value is SerializedBlobRecipientEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "keyFingerprint" in value &&
    typeof value.keyFingerprint === "string" &&
    "kemCipherText" in value &&
    typeof value.kemCipherText === "string" &&
    "wrappedKey" in value &&
    typeof value.wrappedKey === "string"
  );
}

function isSerializedEncryptedBlobEnvelope(
  value: unknown,
): value is SerializedEncryptedBlobEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "format" in value &&
    value.format === ENCRYPTED_BLOB_FORMAT &&
    "iv" in value &&
    typeof value.iv === "string" &&
    "ciphertext" in value &&
    typeof value.ciphertext === "string" &&
    "recipients" in value &&
    Array.isArray(value.recipients) &&
    value.recipients.every((recipient) =>
      isSerializedBlobRecipientEntry(recipient),
    )
  );
}

export function listLoroRecipientKeyFingerprints(
  encryptedData: string,
): string[] {
  return uniqueSortedStrings(
    parseEnvelope(encryptedData).recipients.map(
      (recipient) => recipient.keyFingerprint,
    ),
  );
}

export function extractBlobRecipientEnvelopeEntries(
  encryptedBytes: string,
): PersistedRecipientEnvelopeEntry[] {
  const parsed: unknown = JSON.parse(encryptedBytes);

  if (!isSerializedEncryptedBlobEnvelope(parsed)) {
    throw new Error("Invalid encrypted blob envelope");
  }

  return parsed.recipients.map((recipient) => ({
    keyFingerprint: recipient.keyFingerprint,
    kemCipherText: recipient.kemCipherText,
    wrappedKey: recipient.wrappedKey,
  }));
}

export function listBlobRecipientKeyFingerprints(
  encryptedBytes: string,
): string[] {
  return uniqueSortedStrings(
    extractBlobRecipientEnvelopeEntries(encryptedBytes).map(
      (recipient) => recipient.keyFingerprint,
    ),
  );
}
