import {
  decryptAsRecipient,
  type EncapsulationKeyPair,
  encryptForRecipients,
  generateIdentityKeyPairsFromSeedPhrase,
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_DSA87_SECRET_KEY_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  type SigningKeyPair,
  sign,
  toFingerprint,
  verify,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { isPlainObject } from "@symcrypt/validators/isPlainObject";

export const IDENTITY_KEY_PACKAGE_FORMAT = "symcrypt.identity-key-package";

const KEY_PACKAGE_PROBE_MESSAGE = new TextEncoder().encode(
  "symcrypt.identity-key-package.probe",
);

export interface IdentityKeyPackage {
  readonly createdAt: string;
  readonly encapsulationKeyPair: {
    readonly publicKey: string;
    readonly secretKey: string;
  };
  readonly format: typeof IDENTITY_KEY_PACKAGE_FORMAT;
  readonly seedPhrase?: string | undefined;
  readonly signingFingerprint: string;
  readonly signingKeyPair: {
    readonly signingPrivateKey: string;
    readonly signingPublicKey: string;
  };
  readonly version: 1;
}

interface ParsedIdentityKeyPackage {
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly package: IdentityKeyPackage;
  readonly signingKeyPair: SigningKeyPair;
}

function readStringProperty(
  value: object,
  property: string,
  label: string,
): string {
  const rawValue = Reflect.get(value, property);
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    throw new Error(`Invalid identity key package: ${label} is required.`);
  }

  return rawValue;
}

function readOptionalStringProperty(
  value: object,
  property: string,
  label: string,
): string | null {
  const rawValue = Reflect.get(value, property);
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    throw new Error(`Invalid identity key package: ${label} must be a string.`);
  }

  return rawValue;
}

function readBase64Bytes(input: {
  expectedLength: number;
  label: string;
  value: string;
}): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(input.value);
  } catch (error) {
    throw new Error(
      `Invalid identity key package: ${input.label} must be base64.`,
      { cause: error },
    );
  }

  if (bytes.length !== input.expectedLength) {
    throw new Error(
      `Invalid identity key package: ${input.label} has ${bytes.length} bytes, expected ${input.expectedLength}.`,
    );
  }

  return bytes;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return result === 0;
}

function readMatchingSeedPhrase(input: {
  encapsulationKeyPair: EncapsulationKeyPair;
  seedPhrase: string | null;
  signingKeyPair: SigningKeyPair;
}): string | undefined {
  if (!input.seedPhrase) {
    return undefined;
  }

  let derived: ReturnType<typeof generateIdentityKeyPairsFromSeedPhrase>;
  try {
    derived = generateIdentityKeyPairsFromSeedPhrase(input.seedPhrase);
  } catch (error) {
    throw new Error("Invalid identity key package: seed phrase is invalid.", {
      cause: error,
    });
  }

  if (
    !bytesEqual(
      derived.signingKeyPair.signingPrivateKey,
      input.signingKeyPair.signingPrivateKey,
    ) ||
    !bytesEqual(
      derived.signingKeyPair.signingPublicKey,
      input.signingKeyPair.signingPublicKey,
    ) ||
    !bytesEqual(
      derived.encapsulationKeyPair.secretKey,
      input.encapsulationKeyPair.secretKey,
    ) ||
    !bytesEqual(
      derived.encapsulationKeyPair.publicKey,
      input.encapsulationKeyPair.publicKey,
    )
  ) {
    throw new Error(
      "Invalid identity key package: seed phrase does not match the key pairs.",
    );
  }

  return derived.seedPhrase;
}

function readSigningKeyPair(value: unknown): SigningKeyPair {
  if (!isPlainObject(value)) {
    throw new Error(
      "Invalid identity key package: signingKeyPair is required.",
    );
  }

  return {
    signingPrivateKey: readBase64Bytes({
      expectedLength: ML_DSA87_SECRET_KEY_BYTES,
      label: "signing private key",
      value: readStringProperty(
        value,
        "signingPrivateKey",
        "signing private key",
      ),
    }),
    signingPublicKey: readBase64Bytes({
      expectedLength: ML_DSA87_PUBLIC_KEY_BYTES,
      label: "signing public key",
      value: readStringProperty(
        value,
        "signingPublicKey",
        "signing public key",
      ),
    }),
  };
}

function readEncapsulationKeyPair(value: unknown): EncapsulationKeyPair {
  if (!isPlainObject(value)) {
    throw new Error(
      "Invalid identity key package: encapsulationKeyPair is required.",
    );
  }

  return {
    publicKey: readBase64Bytes({
      expectedLength: ML_KEM1024_PUBLIC_KEY_BYTES,
      label: "encapsulation public key",
      value: readStringProperty(value, "publicKey", "encapsulation public key"),
    }),
    secretKey: readBase64Bytes({
      expectedLength: ML_KEM1024_SECRET_KEY_BYTES,
      label: "encapsulation secret key",
      value: readStringProperty(value, "secretKey", "encapsulation secret key"),
    }),
  };
}

function assertSigningKeyPairMatches(signingKeyPair: SigningKeyPair): void {
  let signature: Uint8Array;
  try {
    signature = sign(
      KEY_PACKAGE_PROBE_MESSAGE,
      signingKeyPair.signingPrivateKey,
    );
  } catch (error) {
    throw new Error(
      "Invalid identity key package: signing private key could not sign.",
      { cause: error },
    );
  }

  if (
    !verify(
      signature,
      KEY_PACKAGE_PROBE_MESSAGE,
      signingKeyPair.signingPublicKey,
    )
  ) {
    throw new Error(
      "Invalid identity key package: signing private key does not match the public key.",
    );
  }
}

async function assertEncapsulationKeyPairMatches(
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<void> {
  try {
    const envelope = await encryptForRecipients(KEY_PACKAGE_PROBE_MESSAGE, [
      encapsulationKeyPair.publicKey,
    ]);
    const decrypted = await decryptAsRecipient(
      envelope,
      encapsulationKeyPair.secretKey,
    );

    if (
      decrypted.length !== KEY_PACKAGE_PROBE_MESSAGE.length ||
      decrypted.some((byte, index) => byte !== KEY_PACKAGE_PROBE_MESSAGE[index])
    ) {
      throw new Error("probe plaintext mismatch");
    }
  } catch (error) {
    throw new Error(
      "Invalid identity key package: encapsulation secret key does not match the public key.",
      { cause: error },
    );
  }
}

export async function createIdentityKeyPackage(input: {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  seedPhrase?: string | null | undefined;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}): Promise<IdentityKeyPackage> {
  if (!input.signingKeyPair || !input.encapsulationKeyPair) {
    throw new Error("Cannot export an identity key package without key pairs.");
  }

  const signingFingerprint =
    input.signingFingerprint ??
    (await toFingerprint(input.signingKeyPair.signingPublicKey));
  const seedPhrase = readMatchingSeedPhrase({
    encapsulationKeyPair: input.encapsulationKeyPair,
    seedPhrase: input.seedPhrase ?? null,
    signingKeyPair: input.signingKeyPair,
  });

  return {
    createdAt: new Date().toISOString(),
    encapsulationKeyPair: {
      publicKey: bytesToBase64(input.encapsulationKeyPair.publicKey),
      secretKey: bytesToBase64(input.encapsulationKeyPair.secretKey),
    },
    format: IDENTITY_KEY_PACKAGE_FORMAT,
    ...(seedPhrase ? { seedPhrase } : {}),
    signingFingerprint,
    signingKeyPair: {
      signingPrivateKey: bytesToBase64(input.signingKeyPair.signingPrivateKey),
      signingPublicKey: bytesToBase64(input.signingKeyPair.signingPublicKey),
    },
    version: 1,
  };
}

export async function parseIdentityKeyPackage(
  value: unknown,
): Promise<ParsedIdentityKeyPackage> {
  if (!isPlainObject(value)) {
    throw new Error("Invalid identity key package: expected an object.");
  }

  const format = readStringProperty(value, "format", "format");
  if (format !== IDENTITY_KEY_PACKAGE_FORMAT) {
    throw new Error("Invalid identity key package: unsupported format.");
  }

  const version = Reflect.get(value, "version");
  if (version !== 1) {
    throw new Error("Invalid identity key package: unsupported version.");
  }

  const signingFingerprint = readStringProperty(
    value,
    "signingFingerprint",
    "signing fingerprint",
  );
  const signingKeyPair = readSigningKeyPair(
    Reflect.get(value, "signingKeyPair"),
  );
  const computedSigningFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  if (computedSigningFingerprint !== signingFingerprint) {
    throw new Error(
      "Invalid identity key package: signing fingerprint does not match the public key.",
    );
  }
  assertSigningKeyPairMatches(signingKeyPair);

  const encapsulationKeyPair = readEncapsulationKeyPair(
    Reflect.get(value, "encapsulationKeyPair"),
  );
  await assertEncapsulationKeyPairMatches(encapsulationKeyPair);
  const seedPhrase = readMatchingSeedPhrase({
    encapsulationKeyPair,
    seedPhrase: readOptionalStringProperty(value, "seedPhrase", "seed phrase"),
    signingKeyPair,
  });

  return {
    encapsulationKeyPair,
    package: {
      createdAt: readStringProperty(value, "createdAt", "created at"),
      encapsulationKeyPair: {
        publicKey: bytesToBase64(encapsulationKeyPair.publicKey),
        secretKey: bytesToBase64(encapsulationKeyPair.secretKey),
      },
      format,
      ...(seedPhrase ? { seedPhrase } : {}),
      signingFingerprint,
      signingKeyPair: {
        signingPrivateKey: bytesToBase64(signingKeyPair.signingPrivateKey),
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
      },
      version,
    },
    signingKeyPair,
  };
}
