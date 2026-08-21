import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import {
  assertWrappedLocalSecretEnvelope,
  canonicalLocalSecretContext,
  copyBytes,
  type LocalSecretContext,
  readObject,
  readString,
  readVersion1,
  readWrappedLocalSecretEnvelope,
  WRAPPED_LOCAL_SECRET_FORMAT,
  type WrappedLocalSecretEnvelope,
  type WrappingKeyHandle,
} from "./index";

export type LocalKeyringPinCode = string | (() => Promise<string> | string);

interface PinCodeWrappingKeyMetadata {
  readonly format: typeof PIN_CODE_WRAPPING_KEY_FORMAT;
  readonly innerKeyId: string;
  readonly innerProvider: string;
  readonly iterations: number;
  readonly kdf: "pbkdf2-sha256";
  readonly salt: string;
  readonly version: 1;
}

export const PIN_CODE_PROVIDER = "pin-code";
export const PIN_CODE_WRAPPING_ALGORITHM = "pin-code-pbkdf2-sha256-aes-256-gcm";

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();
const AES_GCM_IV_BYTES = 12;
const PIN_CODE_SALT_BYTES = 16;
const DEFAULT_PIN_CODE_KDF_ITERATIONS = 310_000;
const PIN_CODE_WRAPPING_KEY_FORMAT =
  "symcrypt.local-keyring.pin-code-wrapping-key";
const PIN_CODE_WRAPPING_KEY_ID_PREFIX = "pin-code:";

export function randomAesGcmIv(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(PIN_CODE_SALT_BYTES));
}

function readPositiveInteger(
  value: ReadonlyMap<string, unknown>,
  key: string,
): number {
  const field = value.get(key);
  if (typeof field !== "number" || !Number.isInteger(field) || field <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return field;
}

function base64BytesFromString(
  encoded: string,
  label: string,
): Uint8Array<ArrayBuffer> {
  try {
    return copyBytes(base64ToBytes(encoded));
  } catch {
    throw new Error(`${label} must be base64.`);
  }
}

export function normalizeKdfIterations(iterations: number | undefined): number {
  if (iterations === undefined) {
    return DEFAULT_PIN_CODE_KDF_ITERATIONS;
  }
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error(
      "PIN code wrapping key KDF iterations must be a positive integer.",
    );
  }

  return iterations;
}

function parseWrappedLocalSecretEnvelope(
  value: unknown,
): WrappedLocalSecretEnvelope {
  // The keyring's envelope reader is the single parser for this wire format;
  // a second hand-rolled parser here would be a drift hazard between what a
  // PIN unlock accepts and what the manifest path accepts.
  return readWrappedLocalSecretEnvelope(
    typeof value === "string" ? JSON.parse(value) : value,
  );
}

export function parseWrappedLocalSecretEnvelopeBytes(
  bytes: ArrayBuffer,
): WrappedLocalSecretEnvelope {
  return parseWrappedLocalSecretEnvelope(TEXT_DECODER.decode(bytes));
}

export function serializeWrappedLocalSecretEnvelope(
  envelope: WrappedLocalSecretEnvelope,
): Uint8Array<ArrayBuffer> {
  assertWrappedLocalSecretEnvelope(envelope);
  return copyBytes(TEXT_ENCODER.encode(JSON.stringify(envelope)));
}

function readPinCodeWrappingKeyMetadata(
  value: unknown,
): PinCodeWrappingKeyMetadata {
  const metadata = readObject(value, "PIN code wrapping key metadata");
  if (readString(metadata, "format") !== PIN_CODE_WRAPPING_KEY_FORMAT) {
    throw new Error("PIN code wrapping key format is unsupported.");
  }
  if (readString(metadata, "kdf") !== "pbkdf2-sha256") {
    throw new Error("PIN code wrapping key derivation is unsupported.");
  }
  const salt = readString(metadata, "salt");
  if (base64BytesFromString(salt, "salt").byteLength === 0) {
    throw new Error("PIN code wrapping key salt must be non-empty.");
  }

  return {
    format: PIN_CODE_WRAPPING_KEY_FORMAT,
    innerKeyId: readString(metadata, "innerKeyId"),
    innerProvider: readString(metadata, "innerProvider"),
    iterations: readPositiveInteger(metadata, "iterations"),
    kdf: "pbkdf2-sha256",
    salt,
    version: readVersion1(metadata),
  };
}

export function createPinCodeWrappingKeyMetadata(input: {
  readonly innerHandle: WrappingKeyHandle;
  readonly iterations: number;
}): PinCodeWrappingKeyMetadata {
  return {
    format: PIN_CODE_WRAPPING_KEY_FORMAT,
    innerKeyId: input.innerHandle.keyId,
    innerProvider: input.innerHandle.provider,
    iterations: input.iterations,
    kdf: "pbkdf2-sha256",
    salt: bytesToBase64(randomSalt()),
    version: 1,
  };
}

export function createPinCodeWrappingKeyId(
  metadata: PinCodeWrappingKeyMetadata,
): string {
  return `${PIN_CODE_WRAPPING_KEY_ID_PREFIX}${bytesToBase64(
    TEXT_ENCODER.encode(JSON.stringify(metadata)),
  )}`;
}

export function parsePinCodeWrappingKeyId(
  keyId: string,
): PinCodeWrappingKeyMetadata {
  if (!keyId.startsWith(PIN_CODE_WRAPPING_KEY_ID_PREFIX)) {
    throw new Error("PIN code wrapping key id is unsupported.");
  }

  try {
    return readPinCodeWrappingKeyMetadata(
      JSON.parse(
        TEXT_DECODER.decode(
          base64ToBytes(keyId.slice(PIN_CODE_WRAPPING_KEY_ID_PREFIX.length)),
        ),
      ),
    );
  } catch (error) {
    throw new Error("PIN code wrapping key id is invalid.", { cause: error });
  }
}

export function pinCodeAdditionalData(input: {
  readonly context: LocalSecretContext;
  readonly keyId: string;
  readonly provider: string;
}): Uint8Array<ArrayBuffer> {
  return copyBytes(
    TEXT_ENCODER.encode(
      JSON.stringify({
        algorithm: PIN_CODE_WRAPPING_ALGORITHM,
        context: JSON.parse(canonicalLocalSecretContext(input.context)),
        format: WRAPPED_LOCAL_SECRET_FORMAT,
        keyId: input.keyId,
        provider: input.provider,
        version: 1,
      }),
    ),
  );
}

async function resolvePinCode(pinCode: LocalKeyringPinCode): Promise<string> {
  const resolved = typeof pinCode === "function" ? await pinCode() : pinCode;
  if (typeof resolved !== "string" || resolved.length === 0) {
    throw new Error("Local keyring PIN code must be non-empty.");
  }

  return resolved;
}

export async function derivePinCodeWrappingKey(input: {
  readonly metadata: PinCodeWrappingKeyMetadata;
  readonly pinCode: LocalKeyringPinCode;
}): Promise<CryptoKey> {
  const pinCode = await resolvePinCode(input.pinCode);
  const pinCodeBytes = TEXT_ENCODER.encode(pinCode);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      pinCodeBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    return await crypto.subtle.deriveKey(
      {
        hash: "SHA-256",
        iterations: input.metadata.iterations,
        name: "PBKDF2",
        salt: base64BytesFromString(input.metadata.salt, "salt"),
      },
      material,
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    pinCodeBytes.fill(0);
  }
}
