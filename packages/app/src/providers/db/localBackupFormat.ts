import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { randomBytes } from "../../utils/randomBytes";

import {
  BACKUP_FORMAT_VERSION,
  BACKUP_PAYLOAD_FORMAT,
  type BackupPayload,
  parseJson,
  readNumber,
  readProperty,
  readRecord,
  readString,
  validateBackupPayload,
} from "./localBackupPayload";

export {
  BACKUP_FORMAT_VERSION,
  BACKUP_PAYLOAD_FORMAT,
  type BackupBlob,
  type BackupIndex,
  type BackupPayload,
  type BackupSqlRow,
  type BackupSqlValue,
  type BackupSummary,
  type BackupTable,
} from "./localBackupPayload";

const BACKUP_FILE_FORMAT = "tearleads.local-backup.encrypted";
const BACKUP_KDF_ITERATIONS = 250_000;
const BACKUP_KDF_MIN_ITERATIONS = 1_000;
const BACKUP_KDF_MAX_ITERATIONS = 1_000_000;
const BACKUP_KEY_BITS = 256;
const BACKUP_SALT_BYTES = 16;
const BACKUP_IV_BYTES = 12;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface BackupFileEnvelope {
  readonly cipher: {
    readonly iv: string;
    readonly name: "AES-GCM";
  };
  readonly format: typeof BACKUP_FILE_FORMAT;
  readonly kdf: {
    readonly hash: "SHA-256";
    readonly iterations: number;
    readonly name: "PBKDF2";
    readonly salt: string;
  };
  readonly payload: string;
  readonly version: typeof BACKUP_FORMAT_VERSION;
}

function readBackupKdfIterations(value: unknown): number {
  const iterations = readNumber(value, "Backup KDF iterations");
  if (
    !Number.isInteger(iterations) ||
    iterations < BACKUP_KDF_MIN_ITERATIONS ||
    iterations > BACKUP_KDF_MAX_ITERATIONS
  ) {
    throw new Error("Backup KDF iterations count is out of safe bounds.");
  }

  return iterations;
}

function copyToArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function deriveBackupKey(input: {
  readonly iterations: number;
  readonly password: string;
  readonly salt: Uint8Array;
}): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(input.password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      iterations: input.iterations,
      name: "PBKDF2",
      salt: copyToArrayBufferBytes(input.salt),
    },
    passwordKey,
    { length: BACKUP_KEY_BITS, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function validateBackupFileEnvelope(value: unknown): BackupFileEnvelope {
  const envelope = readRecord(value, "Backup file");
  if (readProperty(envelope, "format") !== BACKUP_FILE_FORMAT) {
    throw new Error("Backup file format is not supported.");
  }
  if (readProperty(envelope, "version") !== BACKUP_FORMAT_VERSION) {
    throw new Error("Backup file version is not supported.");
  }

  const kdf = readRecord(readProperty(envelope, "kdf"), "Backup KDF");
  if (
    readProperty(kdf, "name") !== "PBKDF2" ||
    readProperty(kdf, "hash") !== "SHA-256"
  ) {
    throw new Error("Backup key derivation is not supported.");
  }

  const cipher = readRecord(readProperty(envelope, "cipher"), "Backup cipher");
  if (readProperty(cipher, "name") !== "AES-GCM") {
    throw new Error("Backup cipher is not supported.");
  }

  return {
    cipher: {
      iv: readString(readProperty(cipher, "iv"), "Backup cipher IV"),
      name: "AES-GCM",
    },
    format: BACKUP_FILE_FORMAT,
    kdf: {
      hash: "SHA-256",
      iterations: readBackupKdfIterations(readProperty(kdf, "iterations")),
      name: "PBKDF2",
      salt: readString(readProperty(kdf, "salt"), "Backup KDF salt"),
    },
    payload: readString(readProperty(envelope, "payload"), "Backup payload"),
    version: BACKUP_FORMAT_VERSION,
  };
}

export async function encodeBackupFile(input: {
  readonly password?: string | undefined;
  readonly payload: BackupPayload;
}): Promise<string> {
  if (input.password === undefined) {
    return `${JSON.stringify(input.payload, null, 2)}\n`;
  }
  if (!input.password) {
    throw new Error("Enter a backup password.");
  }

  const salt = randomBytes(BACKUP_SALT_BYTES);
  const iv = randomBytes(BACKUP_IV_BYTES);
  const key = await deriveBackupKey({
    iterations: BACKUP_KDF_ITERATIONS,
    password: input.password,
    salt,
  });
  const encodedPayload = TEXT_ENCODER.encode(JSON.stringify(input.payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { iv, name: "AES-GCM" },
      key,
      copyToArrayBufferBytes(encodedPayload),
    ),
  );
  const envelope: BackupFileEnvelope = {
    cipher: {
      iv: bytesToBase64(iv),
      name: "AES-GCM",
    },
    format: BACKUP_FILE_FORMAT,
    kdf: {
      hash: "SHA-256",
      iterations: BACKUP_KDF_ITERATIONS,
      name: "PBKDF2",
      salt: bytesToBase64(salt),
    },
    payload: bytesToBase64(ciphertext),
    version: BACKUP_FORMAT_VERSION,
  };

  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function readBackupFile(text: string): BackupPayload | BackupFileEnvelope {
  const file = readRecord(parseJson(text), "Backup file");
  return readProperty(file, "format") === BACKUP_PAYLOAD_FORMAT
    ? validateBackupPayload(file)
    : validateBackupFileEnvelope(file);
}

export function backupFileRequiresPassword(text: string): boolean {
  const file = readRecord(parseJson(text), "Backup file");
  const format = readProperty(file, "format");
  if (format !== BACKUP_FILE_FORMAT && format !== BACKUP_PAYLOAD_FORMAT) {
    throw new Error("Backup file format is not supported.");
  }
  return format === BACKUP_FILE_FORMAT;
}

export async function decodeBackupFile(input: {
  readonly onDecrypt?: (() => void) | undefined;
  readonly password?: string | undefined;
  readonly text: string;
}): Promise<BackupPayload> {
  const envelope = readBackupFile(input.text);
  if (envelope.format === BACKUP_PAYLOAD_FORMAT) {
    return envelope;
  }
  if (!input.password) {
    throw new Error("Enter the restore password.");
  }

  input.onDecrypt?.();
  const key = await deriveBackupKey({
    iterations: envelope.kdf.iterations,
    password: input.password,
    salt: base64ToBytes(envelope.kdf.salt),
  });

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        iv: copyToArrayBufferBytes(base64ToBytes(envelope.cipher.iv)),
        name: "AES-GCM",
      },
      key,
      copyToArrayBufferBytes(base64ToBytes(envelope.payload)),
    );
  } catch (error) {
    throw new Error("Backup password is incorrect or the file is corrupt.", {
      cause: error,
    });
  }

  return validateBackupPayload(parseJson(TEXT_DECODER.decode(plaintext)));
}

export function createBackupFileName(payload: BackupPayload): string {
  const timestamp = payload.createdAt
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replace("T", "-")
    .replace("Z", "");
  const fingerprintPrefix = payload.source.signingFingerprint
    ? `${payload.source.signingFingerprint.slice(0, 12)}-`
    : "";

  return `tearleads-local-backup-${fingerprintPrefix}${timestamp}.tlbackup.json`;
}
