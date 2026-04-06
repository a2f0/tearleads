import { decryptAsRecipient, type EncryptedEnvelope } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type { BlobBytes } from "./blob-store";

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

function serializeBlobEnvelopeValue(
  envelope: EncryptedEnvelope,
): SerializedEncryptedBlobEnvelope {
  return {
    format: ENCRYPTED_BLOB_FORMAT,
    iv: bytesToBase64(envelope.iv),
    ciphertext: bytesToBase64(envelope.ciphertext),
    recipients: envelope.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
  };
}

export function serializeBlobEnvelope(envelope: EncryptedEnvelope): string {
  return JSON.stringify(serializeBlobEnvelopeValue(envelope));
}

function parseBlobEnvelope(encryptedBytes: string): EncryptedEnvelope {
  const parsed: unknown = JSON.parse(encryptedBytes);

  if (!isSerializedEncryptedBlobEnvelope(parsed)) {
    throw new Error("Invalid encrypted blob envelope");
  }

  return {
    ciphertext: base64ToBytes(parsed.ciphertext),
    iv: base64ToBytes(parsed.iv),
    recipients: parsed.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: base64ToBytes(recipient.kemCipherText),
      wrappedKey: base64ToBytes(recipient.wrappedKey),
    })),
  };
}

export async function decryptBlobEnvelope(
  encryptedBytes: string,
  secretKey: Uint8Array,
): Promise<BlobBytes> {
  return decryptAsRecipient(parseBlobEnvelope(encryptedBytes), secretKey);
}
