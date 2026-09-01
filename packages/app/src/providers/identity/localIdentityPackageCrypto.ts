import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { randomBytes } from "../../utils/randomBytes";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const LOCAL_IDENTITY_PACKAGE_FORMAT =
  "tearleads.app.local-identity-key-package";
const AES_GCM_IV_BYTES = 12;

interface LocalIdentityEnvelope {
  readonly algorithm: "aes-256-gcm";
  readonly ciphertext: string;
  readonly format: typeof LOCAL_IDENTITY_PACKAGE_FORMAT;
  readonly iv: string;
  readonly storedAt: string;
  readonly version: 1;
}

function asArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function importAesGcmKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asArrayBufferBytes(key),
    { name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function decodeBase64Bytes(value: string): Uint8Array {
  return new Uint8Array(base64ToBytes(value));
}

function readStringProperty(
  value: object,
  property: string,
  label: string,
): string {
  const rawValue = Reflect.get(value, property);
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return rawValue;
}

function readLocalIdentityEnvelope(value: unknown): LocalIdentityEnvelope {
  const parsedValue: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  if (!isPlainObject(parsedValue)) {
    throw new Error("Local identity package envelope must be an object.");
  }
  const format = readStringProperty(parsedValue, "format", "format");
  if (format !== LOCAL_IDENTITY_PACKAGE_FORMAT) {
    throw new Error("Local identity package envelope format is unsupported.");
  }
  if (Reflect.get(parsedValue, "version") !== 1) {
    throw new Error("Local identity package envelope version is unsupported.");
  }
  const algorithm = readStringProperty(parsedValue, "algorithm", "algorithm");
  if (algorithm !== "aes-256-gcm") {
    throw new Error(
      "Local identity package envelope algorithm is unsupported.",
    );
  }

  return {
    algorithm,
    ciphertext: readStringProperty(parsedValue, "ciphertext", "ciphertext"),
    format,
    iv: readStringProperty(parsedValue, "iv", "iv"),
    storedAt: readStringProperty(parsedValue, "storedAt", "storedAt"),
    version: 1,
  };
}

export async function encryptLocalIdentityPayload(input: {
  readonly identityPersistenceKey: Uint8Array;
  readonly payload: unknown;
}): Promise<string> {
  const key = await importAesGcmKey(input.identityPersistenceKey);
  const iv = asArrayBufferBytes(randomBytes(AES_GCM_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { iv, name: "AES-GCM" },
      key,
      TEXT_ENCODER.encode(JSON.stringify(input.payload)),
    ),
  );
  const envelope: LocalIdentityEnvelope = {
    algorithm: "aes-256-gcm",
    ciphertext: bytesToBase64(ciphertext),
    format: LOCAL_IDENTITY_PACKAGE_FORMAT,
    iv: bytesToBase64(iv),
    storedAt: new Date().toISOString(),
    version: 1,
  };

  return JSON.stringify(envelope);
}

export async function decryptLocalIdentityPayload(input: {
  readonly identityPersistenceKey: Uint8Array;
  readonly serializedEnvelope: string;
}): Promise<unknown> {
  const envelope = readLocalIdentityEnvelope(input.serializedEnvelope);
  const key = await importAesGcmKey(input.identityPersistenceKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      iv: asArrayBufferBytes(decodeBase64Bytes(envelope.iv)),
      name: "AES-GCM",
    },
    key,
    asArrayBufferBytes(decodeBase64Bytes(envelope.ciphertext)),
  );

  return JSON.parse(TEXT_DECODER.decode(plaintext));
}
