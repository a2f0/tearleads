import {
  decryptWithDek,
  encryptWithDek,
  type SymmetricCiphertext,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  hasNumberProperty,
  hasPropertyValue,
  hasStringProperty,
} from "@tearleads/validators/util";

const ENCRYPTED_UPDATE_FORMAT = "tearleads.loro.update.v1";

export interface SerializedEncryptedUpdate {
  format: typeof ENCRYPTED_UPDATE_FORMAT;
  accessEpoch: number;
  iv: string;
  ciphertext: string;
}

interface ParsedEncryptedUpdate extends SymmetricCiphertext {
  accessEpoch: number;
}

function isSerializedEncryptedUpdate(
  value: unknown,
): value is SerializedEncryptedUpdate {
  return (
    isPlainObject(value) &&
    hasPropertyValue(value, "format", ENCRYPTED_UPDATE_FORMAT) &&
    hasNumberProperty(value, "accessEpoch") &&
    Number.isInteger(value.accessEpoch) &&
    value.accessEpoch > 0 &&
    hasStringProperty(value, "iv") &&
    hasStringProperty(value, "ciphertext")
  );
}

function decodeEnvelope(
  envelope: SerializedEncryptedUpdate,
): ParsedEncryptedUpdate {
  return {
    accessEpoch: envelope.accessEpoch,
    iv: base64ToBytes(envelope.iv),
    ciphertext: base64ToBytes(envelope.ciphertext),
  };
}

export async function encryptLoroUpdate(
  plaintext: Uint8Array,
  accessEpoch: number,
  documentKey: Uint8Array,
): Promise<string> {
  const envelope = await encryptWithDek(plaintext, documentKey);

  return JSON.stringify(
    serializeEnvelope({
      accessEpoch,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
    }),
  );
}

export async function decryptLoroUpdate(
  encryptedData: string,
  accessEpoch: number,
  documentKey: Uint8Array,
): Promise<Uint8Array> {
  const parsed = parseEncryptedUpdate(encryptedData);

  if (parsed.accessEpoch !== accessEpoch) {
    throw new Error("Encrypted Loro update access epoch mismatch");
  }

  return decryptWithDek(parsed, documentKey);
}

export function serializeEnvelope(
  envelope: ParsedEncryptedUpdate,
): SerializedEncryptedUpdate {
  return {
    format: ENCRYPTED_UPDATE_FORMAT,
    accessEpoch: envelope.accessEpoch,
    iv: bytesToBase64(envelope.iv),
    ciphertext: bytesToBase64(envelope.ciphertext),
  };
}

/**
 * Parse the JSON wire format used by encrypted Loro updates and decode it into
 * the symmetric ciphertext expected by the document sync layer.
 *
 * This stays in `packages/loro` rather than the generic validators package
 * because the serialized format is feature-local and the final output type is a
 * sync-local ciphertext descriptor, not an API request/response contract.
 */
export function parseEncryptedUpdate(
  encryptedData: string,
): ParsedEncryptedUpdate {
  const value: unknown = JSON.parse(encryptedData);

  if (!isSerializedEncryptedUpdate(value)) {
    throw new Error("Invalid encrypted Loro update envelope");
  }

  return decodeEnvelope(value);
}

export function readEncryptedUpdateAccessEpoch(encryptedData: string): number {
  return parseEncryptedUpdate(encryptedData).accessEpoch;
}
