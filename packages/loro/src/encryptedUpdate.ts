import {
  decryptAsRecipient,
  type EncryptedEnvelope,
  encryptForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

const ENCRYPTED_UPDATE_FORMAT = "tearleads.loro.update.v1";

function hasStringProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string> {
  return typeof value[key] === "string";
}

function hasArrayProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, unknown[]> {
  return Array.isArray(value[key]);
}

function hasExactProperty<Key extends string, ExactValue extends string>(
  value: Record<string, unknown>,
  key: Key,
  expected: ExactValue,
): value is Record<string, unknown> & Record<Key, ExactValue> {
  return value[key] === expected;
}

export interface SerializedRecipientEntry {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export interface SerializedEncryptedUpdate {
  format: typeof ENCRYPTED_UPDATE_FORMAT;
  iv: string;
  ciphertext: string;
  recipients: SerializedRecipientEntry[];
}

function isSerializedRecipientEntry(
  value: unknown,
): value is SerializedRecipientEntry {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "keyFingerprint") &&
    hasStringProperty(value, "kemCipherText") &&
    hasStringProperty(value, "wrappedKey")
  );
}

function isSerializedEncryptedUpdate(
  value: unknown,
): value is SerializedEncryptedUpdate {
  return (
    isPlainObject(value) &&
    hasExactProperty(value, "format", ENCRYPTED_UPDATE_FORMAT) &&
    hasStringProperty(value, "iv") &&
    hasStringProperty(value, "ciphertext") &&
    hasArrayProperty(value, "recipients") &&
    value.recipients.every(isSerializedRecipientEntry)
  );
}

function decodeEnvelope(
  envelope: SerializedEncryptedUpdate,
): EncryptedEnvelope {
  return {
    iv: base64ToBytes(envelope.iv),
    ciphertext: base64ToBytes(envelope.ciphertext),
    recipients: envelope.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: base64ToBytes(recipient.kemCipherText),
      wrappedKey: base64ToBytes(recipient.wrappedKey),
    })),
  };
}

export async function encryptLoroUpdate(
  plaintext: Uint8Array,
  recipientPublicKeys: Uint8Array[],
): Promise<string> {
  const envelope = await encryptForRecipients(plaintext, recipientPublicKeys);
  return JSON.stringify(serializeEnvelope(envelope));
}

export async function decryptLoroUpdate(
  encryptedData: string,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  return decryptAsRecipient(parseEnvelope(encryptedData), secretKey);
}

export function serializeEnvelope(
  envelope: EncryptedEnvelope,
): SerializedEncryptedUpdate {
  return {
    format: ENCRYPTED_UPDATE_FORMAT,
    iv: bytesToBase64(envelope.iv),
    ciphertext: bytesToBase64(envelope.ciphertext),
    recipients: envelope.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
  };
}

/**
 * Parse the JSON wire format used by encrypted Loro updates and decode it into
 * the binary envelope expected by `@tearleads/crypto`.
 *
 * This stays in `packages/loro` rather than the generic validators package
 * because the serialized format is feature-local and the final output type is a
 * crypto envelope, not an API request/response contract.
 */
export function parseEnvelope(encryptedData: string): EncryptedEnvelope {
  const value: unknown = JSON.parse(encryptedData);

  if (!isSerializedEncryptedUpdate(value)) {
    throw new Error("Invalid encrypted Loro update envelope");
  }

  return decodeEnvelope(value);
}
