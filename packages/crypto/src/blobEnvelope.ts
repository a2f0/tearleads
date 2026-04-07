import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type { EncryptedEnvelope, RecipientEntry } from "./encapsulation/types";

const ENCRYPTED_BLOB_FORMAT_V2 = "tearleads.blob.v2";
const ENCRYPTED_BLOB_PREFIX_V2 = `${ENCRYPTED_BLOB_FORMAT_V2}\n`;

export interface SerializedBlobRecipientEntry {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export interface SerializedBlobEnvelopeHeader {
  iv: string;
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

function isSerializedBlobEnvelopeHeader(
  value: unknown,
): value is SerializedBlobEnvelopeHeader {
  return (
    typeof value === "object" &&
    value !== null &&
    "iv" in value &&
    typeof value.iv === "string" &&
    "recipients" in value &&
    Array.isArray(value.recipients) &&
    value.recipients.every((recipient) =>
      isSerializedBlobRecipientEntry(recipient),
    )
  );
}

function encodeRecipients(
  recipients: RecipientEntry[],
): SerializedBlobRecipientEntry[] {
  return recipients.map((recipient) => ({
    keyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
  }));
}

function decodeRecipients(
  recipients: SerializedBlobRecipientEntry[],
): RecipientEntry[] {
  return recipients.map((recipient) => ({
    keyFingerprint: recipient.keyFingerprint,
    kemCipherText: base64ToBytes(recipient.kemCipherText),
    wrappedKey: base64ToBytes(recipient.wrappedKey),
  }));
}

function parseV2WireParts(encryptedBytes: string): {
  header: SerializedBlobEnvelopeHeader;
  ciphertext: string;
} {
  const headerStart = ENCRYPTED_BLOB_PREFIX_V2.length;
  const headerEnd = encryptedBytes.indexOf("\n", headerStart);

  if (headerEnd < 0) {
    throw new Error("Invalid encrypted blob envelope");
  }

  const parsedHeader: unknown = JSON.parse(
    encryptedBytes.slice(headerStart, headerEnd),
  );

  if (!isSerializedBlobEnvelopeHeader(parsedHeader)) {
    throw new Error("Invalid encrypted blob envelope");
  }

  return {
    header: parsedHeader,
    ciphertext: encryptedBytes.slice(headerEnd + 1),
  };
}

export function serializeBlobEnvelope(envelope: EncryptedEnvelope): string {
  return [
    ENCRYPTED_BLOB_FORMAT_V2,
    JSON.stringify({
      iv: bytesToBase64(envelope.iv),
      recipients: encodeRecipients(envelope.recipients),
    } satisfies SerializedBlobEnvelopeHeader),
    bytesToBase64(envelope.ciphertext),
  ].join("\n");
}

export function parseBlobEnvelopeHeader(
  encryptedBytes: string,
): SerializedBlobEnvelopeHeader {
  if (!encryptedBytes.startsWith(ENCRYPTED_BLOB_PREFIX_V2)) {
    throw new Error("Invalid encrypted blob envelope");
  }

  return parseV2WireParts(encryptedBytes).header;
}

export function parseBlobEnvelope(encryptedBytes: string): EncryptedEnvelope {
  if (!encryptedBytes.startsWith(ENCRYPTED_BLOB_PREFIX_V2)) {
    throw new Error("Invalid encrypted blob envelope");
  }

  const { header, ciphertext } = parseV2WireParts(encryptedBytes);

  return {
    iv: base64ToBytes(header.iv),
    ciphertext: base64ToBytes(ciphertext),
    recipients: decodeRecipients(header.recipients),
  };
}
