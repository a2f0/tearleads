import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  type LocalKeyPurpose,
  type LocalSecretContext,
  type NormalizedLocalKeyringScope,
  normalizeLocalKeyringScope,
  WRAPPED_LOCAL_SECRET_FORMAT,
  type WrappedLocalSecretEnvelope,
  type WrappingKeyHandle,
} from "./localKeyring";

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
  "tearleads.local-keyring.pin-code-wrapping-key";
const PIN_CODE_WRAPPING_KEY_ID_PREFIX = "pin-code:";

export function asArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function randomAesGcmIv(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(PIN_CODE_SALT_BYTES));
}

export function assertNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must be non-empty.`);
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function readString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }

  return field;
}

function readExactString<const ExpectedValue extends string>(
  value: Record<string, unknown>,
  key: string,
  label: string,
  expectedValue: ExpectedValue,
): ExpectedValue {
  const field = readString(value, key, label);
  if (field !== expectedValue) {
    throw new Error(`${label}.${key} must be ${expectedValue}.`);
  }

  return expectedValue;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }

  return field;
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const field = value[key];
  if (field === null) {
    return null;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string or null.`);
  }

  return field;
}

function readPositiveInteger(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isInteger(field) || field <= 0) {
    throw new Error(`${label}.${key} must be a positive integer.`);
  }

  return field;
}

function readVersion1(value: Record<string, unknown>, label: string): 1 {
  if (Reflect.get(value, "version") !== 1) {
    throw new Error(`${label}.version must be 1.`);
  }

  return 1;
}

function readBase64Bytes(
  value: Record<string, unknown>,
  key: string,
  label: string,
): Uint8Array<ArrayBuffer> {
  const encoded = readString(value, key, label);
  try {
    return asArrayBufferBytes(base64ToBytes(encoded));
  } catch {
    throw new Error(`${label}.${key} must be base64.`);
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

function readLocalKeyringScope(
  value: unknown,
  label: string,
): NormalizedLocalKeyringScope {
  const scope = readRecord(value, label);
  return normalizeLocalKeyringScope({
    accountId: readNullableString(scope, "accountId", label),
    namespace: readString(scope, "namespace", label),
    signingFingerprint: readNullableString(scope, "signingFingerprint", label),
  });
}

function localSecretContext(
  scope: NormalizedLocalKeyringScope,
  purpose: LocalKeyPurpose,
): LocalSecretContext {
  assertNonEmptyString(purpose, "Local key purpose");
  return { purpose, scope };
}

function readLocalSecretContext(value: unknown): LocalSecretContext {
  const context = readRecord(value, "Wrapped local secret context");
  return localSecretContext(
    readLocalKeyringScope(
      Reflect.get(context, "scope"),
      "Wrapped local secret context.scope",
    ),
    readString(context, "purpose", "Wrapped local secret context"),
  );
}

function canonicalLocalSecretContext(context: LocalSecretContext): string {
  return JSON.stringify({
    purpose: context.purpose,
    scope: normalizeLocalKeyringScope(context.scope),
  });
}

export function assertEnvelopeContextMatches(input: {
  readonly actual: LocalSecretContext;
  readonly expected: LocalSecretContext;
}): void {
  if (
    canonicalLocalSecretContext(input.actual) !==
    canonicalLocalSecretContext(input.expected)
  ) {
    throw new Error("Wrapped local secret context does not match.");
  }
}

export function assertWrappedLocalSecretEnvelope(
  envelope: WrappedLocalSecretEnvelope,
): void {
  if (envelope.format !== WRAPPED_LOCAL_SECRET_FORMAT) {
    throw new Error("Wrapped local secret envelope format is unsupported.");
  }
  if (envelope.version !== 1) {
    throw new Error("Wrapped local secret envelope version is unsupported.");
  }
  assertNonEmptyString(envelope.algorithm, "Wrapped local secret algorithm");
  assertNonEmptyString(envelope.ciphertext, "Wrapped local secret ciphertext");
  assertNonEmptyString(envelope.keyId, "Wrapped local secret key id");
  assertNonEmptyString(envelope.provider, "Wrapped local secret provider");
  assertNonEmptyString(envelope.wrappedAt, "Wrapped local secret wrappedAt");
  normalizeLocalKeyringScope(envelope.context.scope);
  assertNonEmptyString(
    envelope.context.purpose,
    "Wrapped local secret purpose",
  );
}

function parseWrappedLocalSecretEnvelope(
  value: unknown,
): WrappedLocalSecretEnvelope {
  const parsedValue: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  const envelope = readRecord(parsedValue, "Wrapped local secret envelope");
  const parsed = {
    algorithm: readString(envelope, "algorithm", "Wrapped local secret"),
    ciphertext: readString(envelope, "ciphertext", "Wrapped local secret"),
    context: readLocalSecretContext(Reflect.get(envelope, "context")),
    format: readExactString(
      envelope,
      "format",
      "Wrapped local secret",
      WRAPPED_LOCAL_SECRET_FORMAT,
    ),
    iv: readOptionalString(envelope, "iv", "Wrapped local secret"),
    keyId: readString(envelope, "keyId", "Wrapped local secret"),
    provider: readString(envelope, "provider", "Wrapped local secret"),
    version: readVersion1(envelope, "Wrapped local secret"),
    wrappedAt: readString(envelope, "wrappedAt", "Wrapped local secret"),
  } satisfies WrappedLocalSecretEnvelope;
  assertWrappedLocalSecretEnvelope(parsed);
  return parsed;
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
  return asArrayBufferBytes(TEXT_ENCODER.encode(JSON.stringify(envelope)));
}

function readPinCodeWrappingKeyMetadata(
  value: unknown,
): PinCodeWrappingKeyMetadata {
  const metadata = readRecord(value, "PIN code wrapping key metadata");
  if (
    readString(metadata, "format", "PIN code wrapping key metadata") !==
    PIN_CODE_WRAPPING_KEY_FORMAT
  ) {
    throw new Error("PIN code wrapping key format is unsupported.");
  }
  if (
    readString(metadata, "kdf", "PIN code wrapping key metadata") !==
    "pbkdf2-sha256"
  ) {
    throw new Error("PIN code wrapping key derivation is unsupported.");
  }
  if (
    readBase64Bytes(metadata, "salt", "PIN code wrapping key metadata")
      .byteLength === 0
  ) {
    throw new Error("PIN code wrapping key salt must be non-empty.");
  }

  return {
    format: PIN_CODE_WRAPPING_KEY_FORMAT,
    innerKeyId: readString(
      metadata,
      "innerKeyId",
      "PIN code wrapping key metadata",
    ),
    innerProvider: readString(
      metadata,
      "innerProvider",
      "PIN code wrapping key metadata",
    ),
    iterations: readPositiveInteger(
      metadata,
      "iterations",
      "PIN code wrapping key metadata",
    ),
    kdf: "pbkdf2-sha256",
    salt: readString(metadata, "salt", "PIN code wrapping key metadata"),
    version: readVersion1(metadata, "PIN code wrapping key metadata"),
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
  return asArrayBufferBytes(
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
  const material = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(pinCode),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      iterations: input.metadata.iterations,
      name: "PBKDF2",
      salt: readBase64Bytes(
        { salt: input.metadata.salt },
        "salt",
        "PIN code wrapping key metadata",
      ),
    },
    material,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
