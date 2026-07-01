import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type { PutKeyPackageBackupRequest } from "@tearleads/validators/request";
import type { KeyPackageBackupResponse } from "@tearleads/validators/response";
import {
  KEY_PACKAGE_BACKUP_ENCRYPTION_SUITE,
  KEY_PACKAGE_BACKUP_ENVELOPE_FORMAT,
  KEY_PACKAGE_BACKUP_KDF_SUITE,
} from "@tearleads/validators/util";
import type { AppKeyPackage } from "./keyPackageBackup";
import {
  asArrayBufferBytes,
  readAttestationMetadata,
  readPrfOutput,
  readPublicKeyCredential,
} from "./keyPackageBackupPasskeyWebAuthn";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const AES_GCM_IV_BYTES = 12;
const BACKUP_VERSION = 1;
const ENVELOPE_VERSION = 1;
const PRF_SALT_VERSION = 1;

export type PasskeyAuthenticatorAttachment = "cross-platform" | "platform";

interface CreatedPasskeyCredential {
  readonly credential: PutKeyPackageBackupRequest["credential"];
  readonly prfOutput: Uint8Array<ArrayBuffer> | null;
}

interface AssociatedDataInput {
  readonly backupId: string;
  readonly backupVersion: number;
  readonly credentialId: string;
  readonly credentialPublicKey: string;
  readonly credentialPublicKeyAlgorithm: number;
  readonly credentialTransports: readonly string[];
  readonly encryptionSuite: typeof KEY_PACKAGE_BACKUP_ENCRYPTION_SUITE;
  readonly envelopeVersion: number;
  readonly format: typeof KEY_PACKAGE_BACKUP_ENVELOPE_FORMAT;
  readonly kdfSuite: typeof KEY_PACKAGE_BACKUP_KDF_SUITE;
  readonly prfSaltVersion: 1;
  readonly signingKeyFingerprint: string;
}

function randomBytes(byteLength: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const byteLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(byteLength);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }

  return combined;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", asArrayBufferBytes(bytes)),
  );
}

function requirePasskeyBackupSupport(): void {
  if (!isPasskeyKeyPackageBackupSupported()) {
    throw new Error(
      "Passkey PRF key package backups require a secure browser with WebAuthn PRF support.",
    );
  }
}

function backupAssociatedData(
  input: AssociatedDataInput,
): Uint8Array<ArrayBuffer> {
  return asArrayBufferBytes(
    TEXT_ENCODER.encode(
      JSON.stringify({
        backupId: input.backupId,
        backupVersion: input.backupVersion,
        credentialId: input.credentialId,
        credentialPublicKey: input.credentialPublicKey,
        credentialPublicKeyAlgorithm: input.credentialPublicKeyAlgorithm,
        credentialTransports: input.credentialTransports,
        encryptionSuite: input.encryptionSuite,
        envelopeVersion: input.envelopeVersion,
        format: input.format,
        kdfSuite: input.kdfSuite,
        prfSaltVersion: input.prfSaltVersion,
        signingKeyFingerprint: input.signingKeyFingerprint,
      }),
    ),
  );
}

async function createPrfSalt(
  backupId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(
    concatBytes([
      TEXT_ENCODER.encode(
        `tearleads.passkey-key-package-backup.prf-salt.v1:${backupId}:`,
      ),
      randomBytes(32),
    ]),
  );
}

async function deriveBackupWrappingKey(input: {
  readonly backupId: string;
  readonly credentialId: string;
  readonly prfOutput: Uint8Array;
  readonly signingKeyFingerprint: string;
}): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    asArrayBufferBytes(input.prfOutput),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const salt = await sha256(
    TEXT_ENCODER.encode(
      [
        "tearleads.passkey-key-package-backup.hkdf-salt.v1",
        input.backupId,
        input.credentialId,
        input.signingKeyFingerprint,
      ].join("\0"),
    ),
  );
  const bits = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      info: TEXT_ENCODER.encode(
        "tearleads.passkey-key-package-backup.wrapping-key.v1",
      ),
      name: "HKDF",
      salt,
    },
    keyMaterial,
    256,
  );

  return new Uint8Array(bits);
}

async function importAesGcmKey(
  keyBytes: Uint8Array,
  usage: "decrypt" | "encrypt",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asArrayBufferBytes(keyBytes),
    { name: "AES-GCM" },
    false,
    [usage],
  );
}

async function createPasskeyCredential(input: {
  readonly authenticatorAttachment?: PasskeyAuthenticatorAttachment | undefined;
  readonly prfSalt: Uint8Array;
  readonly signingKeyFingerprint: string;
}): Promise<CreatedPasskeyCredential> {
  const publicKey = {
    authenticatorSelection: {
      // authenticatorAttachment is intentionally optional: when unset the
      // browser chooses the authenticator UI (platform vs security key vs
      // cross-device QR), which is why the prompt differs across browsers.
      ...(input.authenticatorAttachment
        ? { authenticatorAttachment: input.authenticatorAttachment }
        : {}),
      requireResidentKey: true,
      residentKey: "required",
      userVerification: "required",
    },
    challenge: randomBytes(32),
    extensions: {
      prf: {
        eval: {
          first: asArrayBufferBytes(input.prfSalt),
        },
      },
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },
      { alg: -257, type: "public-key" },
    ],
    rp: { name: "Tearleads" },
    timeout: 120_000,
    user: {
      displayName: "Tearleads identity backup",
      id: randomBytes(32),
      name: `tearleads-${input.signingKeyFingerprint.slice(0, 24)}`,
    },
  } satisfies PublicKeyCredentialCreationOptions;
  const credential = readPublicKeyCredential(
    await navigator.credentials.create({ publicKey }),
    "Passkey creation",
  );
  const prf = credential.prf();
  const prfOutput = readPrfOutput(prf);
  if (prf?.enabled !== true && !prfOutput) {
    throw new Error("This passkey does not support WebAuthn PRF.");
  }

  const metadata = readAttestationMetadata(credential.response);

  return {
    credential: {
      id: bytesToBase64(new Uint8Array(credential.rawId)),
      publicKey: bytesToBase64(new Uint8Array(metadata.publicKey)),
      publicKeyAlgorithm: metadata.publicKeyAlgorithm,
      transports: metadata.transports,
      type: "public-key",
    },
    prfOutput,
  };
}

async function requestPasskeyPrfOutput(input: {
  readonly credentialId: string;
  readonly prfSalt: Uint8Array;
}): Promise<Uint8Array<ArrayBuffer>> {
  const publicKey = {
    allowCredentials: [
      {
        id: asArrayBufferBytes(base64ToBytes(input.credentialId)),
        type: "public-key",
      },
    ],
    challenge: randomBytes(32),
    extensions: {
      prf: {
        eval: {
          first: asArrayBufferBytes(input.prfSalt),
        },
      },
    },
    timeout: 120_000,
    userVerification: "required",
  } satisfies PublicKeyCredentialRequestOptions;
  const credential = readPublicKeyCredential(
    await navigator.credentials.get({ publicKey }),
    "Passkey assertion",
  );
  const prfOutput = readPrfOutput(credential.prf());
  if (!prfOutput) {
    throw new Error("Passkey PRF output is unavailable.");
  }

  return prfOutput;
}

export function isPasskeyKeyPackageBackupSupported(): boolean {
  return (
    typeof window === "object" &&
    window.isSecureContext !== false &&
    typeof PublicKeyCredential === "function" &&
    typeof navigator === "object" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials.get === "function" &&
    typeof crypto === "object" &&
    typeof crypto.subtle === "object"
  );
}

export async function createPasskeyProtectedKeyPackageBackup(input: {
  readonly authenticatorAttachment?: PasskeyAuthenticatorAttachment | undefined;
  readonly keyPackage: AppKeyPackage;
  readonly signingKeyFingerprint: string;
}): Promise<PutKeyPackageBackupRequest> {
  requirePasskeyBackupSupport();
  const backupId = crypto.randomUUID();
  const prfSalt = await createPrfSalt(backupId);
  const { credential, prfOutput: maybePrfOutput } =
    await createPasskeyCredential({
      authenticatorAttachment: input.authenticatorAttachment,
      prfSalt,
      signingKeyFingerprint: input.signingKeyFingerprint,
    });
  const prfOutput =
    maybePrfOutput ??
    (await requestPasskeyPrfOutput({
      credentialId: credential.id,
      prfSalt,
    }));
  const wrappingKey = await deriveBackupWrappingKey({
    backupId,
    credentialId: credential.id,
    prfOutput,
    signingKeyFingerprint: input.signingKeyFingerprint,
  });
  const associatedData = backupAssociatedData({
    backupId,
    backupVersion: BACKUP_VERSION,
    credentialId: credential.id,
    credentialPublicKey: credential.publicKey,
    credentialPublicKeyAlgorithm: credential.publicKeyAlgorithm,
    credentialTransports: credential.transports,
    encryptionSuite: KEY_PACKAGE_BACKUP_ENCRYPTION_SUITE,
    envelopeVersion: ENVELOPE_VERSION,
    format: KEY_PACKAGE_BACKUP_ENVELOPE_FORMAT,
    kdfSuite: KEY_PACKAGE_BACKUP_KDF_SUITE,
    prfSaltVersion: PRF_SALT_VERSION,
    signingKeyFingerprint: input.signingKeyFingerprint,
  });
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const key = await importAesGcmKey(wrappingKey, "encrypt");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        additionalData: associatedData,
        iv,
        name: "AES-GCM",
      },
      key,
      TEXT_ENCODER.encode(JSON.stringify(input.keyPackage)),
    ),
  );

  return {
    backupId,
    backupVersion: BACKUP_VERSION,
    credential,
    envelope: {
      ciphertext: bytesToBase64(ciphertext),
      encryptionSuite: KEY_PACKAGE_BACKUP_ENCRYPTION_SUITE,
      format: KEY_PACKAGE_BACKUP_ENVELOPE_FORMAT,
      iv: bytesToBase64(iv),
      version: ENVELOPE_VERSION,
    },
    kdfSuite: KEY_PACKAGE_BACKUP_KDF_SUITE,
    prfSalt: bytesToBase64(prfSalt),
    prfSaltVersion: PRF_SALT_VERSION,
    signingKeyFingerprint: input.signingKeyFingerprint,
  };
}

export async function discoverPasskeyKeyPackageBackupCredentialId(): Promise<string> {
  requirePasskeyBackupSupport();
  const publicKey = {
    challenge: randomBytes(32),
    timeout: 120_000,
    userVerification: "required",
  } satisfies PublicKeyCredentialRequestOptions;
  const credential = readPublicKeyCredential(
    await navigator.credentials.get({ publicKey }),
    "Passkey discovery",
  );

  return bytesToBase64(new Uint8Array(credential.rawId));
}

export async function decryptPasskeyProtectedKeyPackageBackup(
  backup: KeyPackageBackupResponse,
): Promise<unknown> {
  requirePasskeyBackupSupport();
  const prfSalt = base64ToBytes(backup.prfSalt);
  const prfOutput = await requestPasskeyPrfOutput({
    credentialId: backup.credential.id,
    prfSalt,
  });
  const wrappingKey = await deriveBackupWrappingKey({
    backupId: backup.backupId,
    credentialId: backup.credential.id,
    prfOutput,
    signingKeyFingerprint: backup.signingKeyFingerprint,
  });
  const key = await importAesGcmKey(wrappingKey, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: backupAssociatedData({
        backupId: backup.backupId,
        backupVersion: backup.backupVersion,
        credentialId: backup.credential.id,
        credentialPublicKey: backup.credential.publicKey,
        credentialPublicKeyAlgorithm: backup.credential.publicKeyAlgorithm,
        credentialTransports: backup.credential.transports,
        encryptionSuite: backup.envelope.encryptionSuite,
        envelopeVersion: backup.envelope.version,
        format: backup.envelope.format,
        kdfSuite: backup.kdfSuite,
        prfSaltVersion: backup.prfSaltVersion,
        signingKeyFingerprint: backup.signingKeyFingerprint,
      }),
      iv: asArrayBufferBytes(base64ToBytes(backup.envelope.iv)),
      name: "AES-GCM",
    },
    key,
    asArrayBufferBytes(base64ToBytes(backup.envelope.ciphertext)),
  );

  return JSON.parse(TEXT_DECODER.decode(plaintext));
}
