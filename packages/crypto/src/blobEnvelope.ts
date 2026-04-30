import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { ML_KEM1024_CIPHERTEXT_BYTES } from "./encapsulation/generateKeyPair";
import type { EncryptedEnvelope, RecipientEntry } from "./encapsulation/types";
import { AES_GCM_IV_BYTES, AES_GCM_TAG_BYTES } from "./symmetric";

const ENCRYPTED_BLOB_FORMAT = "tearleads.blob.v1";
const ENCRYPTED_BLOB_PREFIX = `${ENCRYPTED_BLOB_FORMAT}\n`;
const SERIALIZED_BLOB_RECIPIENT_KEYS = [
  "kemCipherText",
  "keyFingerprint",
  "wrappedKey",
] as const;
const SERIALIZED_BLOB_HEADER_KEYS = ["iv", "recipients"] as const;

export interface SerializedBlobRecipientEntry {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export interface SerializedBlobEnvelopeHeader {
  iv: string;
  recipients: SerializedBlobRecipientEntry[];
}

type SerializedBlobRecipientRecord = Partial<
  Record<keyof SerializedBlobRecipientEntry, unknown>
> &
  Record<string, unknown>;

type SerializedBlobEnvelopeHeaderRecord = Partial<
  Record<keyof SerializedBlobEnvelopeHeader, unknown>
> &
  Record<string, unknown>;

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isSerializedBlobRecipientEntry(
  value: unknown,
): value is SerializedBlobRecipientEntry {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as SerializedBlobRecipientRecord)
      : null;

  return (
    record !== null &&
    hasExactKeys(record, SERIALIZED_BLOB_RECIPIENT_KEYS) &&
    typeof record.keyFingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(record.keyFingerprint) &&
    typeof record.kemCipherText === "string" &&
    typeof record.wrappedKey === "string"
  );
}

function isSerializedBlobEnvelopeHeader(
  value: unknown,
): value is SerializedBlobEnvelopeHeader {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as SerializedBlobEnvelopeHeaderRecord)
      : null;
  if (
    record === null ||
    !hasExactKeys(record, SERIALIZED_BLOB_HEADER_KEYS) ||
    typeof record.iv !== "string" ||
    !Array.isArray(record.recipients) ||
    record.recipients.length === 0 ||
    !record.recipients.every((recipient) =>
      isSerializedBlobRecipientEntry(recipient),
    )
  ) {
    return false;
  }

  const recipients = record.recipients as SerializedBlobRecipientEntry[];
  return (
    new Set(recipients.map((recipient) => recipient.keyFingerprint)).size ===
    recipients.length
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

function parseWireParts(encryptedBytes: string): {
  header: SerializedBlobEnvelopeHeader;
  ciphertext: string;
} {
  const headerStart = ENCRYPTED_BLOB_PREFIX.length;
  const headerEnd = encryptedBytes.indexOf("\n", headerStart);

  if (headerEnd < 0) {
    throw new Error("Invalid encrypted blob envelope");
  }

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(encryptedBytes.slice(headerStart, headerEnd));
  } catch {
    throw new Error("Invalid encrypted blob envelope");
  }

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
    ENCRYPTED_BLOB_FORMAT,
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
  if (!encryptedBytes.startsWith(ENCRYPTED_BLOB_PREFIX)) {
    throw new Error("Invalid encrypted blob envelope");
  }

  return parseWireParts(encryptedBytes).header;
}

export function parseBlobEnvelope(encryptedBytes: string): EncryptedEnvelope {
  if (!encryptedBytes.startsWith(ENCRYPTED_BLOB_PREFIX)) {
    throw new Error("Invalid encrypted blob envelope");
  }

  const { header, ciphertext } = parseWireParts(encryptedBytes);

  let envelope: EncryptedEnvelope;
  try {
    envelope = {
      iv: base64ToBytes(header.iv),
      ciphertext: base64ToBytes(ciphertext),
      recipients: decodeRecipients(header.recipients),
    };
  } catch {
    throw new Error("Invalid encrypted blob envelope");
  }

  if (envelope.iv.length !== AES_GCM_IV_BYTES) {
    throw new Error("Invalid encrypted blob envelope");
  }
  if (envelope.ciphertext.length < AES_GCM_TAG_BYTES) {
    throw new Error("Invalid encrypted blob envelope");
  }
  for (const recipient of envelope.recipients) {
    if (
      recipient.kemCipherText.length !== ML_KEM1024_CIPHERTEXT_BYTES ||
      recipient.wrappedKey.length < AES_GCM_TAG_BYTES ||
      !/^[0-9a-f]{64}$/.test(recipient.keyFingerprint)
    ) {
      throw new Error("Invalid encrypted blob envelope");
    }
  }

  return envelope;
}
