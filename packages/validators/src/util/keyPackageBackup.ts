import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNonEmptyStringProperty,
  hasNumberProperty,
  hasPropertyValue,
} from "./properties";

export const KEY_PACKAGE_BACKUP_ENVELOPE_FORMAT =
  "tearleads.identity-key-package.passkey-backup";
export const KEY_PACKAGE_BACKUP_ENCRYPTION_SUITE = "aes-256-gcm";
export const KEY_PACKAGE_BACKUP_KDF_SUITE = "webauthn-prf-hkdf-sha256";

export interface KeyPackageBackupCredentialWire {
  readonly id: string;
  readonly publicKey: string;
  readonly publicKeyAlgorithm: number;
  readonly transports: readonly string[];
  readonly type: "public-key";
}

export interface KeyPackageBackupEnvelopeWire {
  readonly ciphertext: string;
  readonly encryptionSuite: typeof KEY_PACKAGE_BACKUP_ENCRYPTION_SUITE;
  readonly format: typeof KEY_PACKAGE_BACKUP_ENVELOPE_FORMAT;
  readonly iv: string;
  readonly version: 1;
}

export function isKeyPackageBackupCredentialWire(
  value: unknown,
): value is KeyPackageBackupCredentialWire {
  return (
    isPlainObject(value) &&
    hasPropertyValue(value, "type", "public-key") &&
    hasNonEmptyStringProperty(value, "id") &&
    hasNonEmptyStringProperty(value, "publicKey") &&
    hasNumberProperty(value, "publicKeyAlgorithm") &&
    Number.isInteger(value.publicKeyAlgorithm) &&
    hasArrayProperty(value, "transports") &&
    value.transports.every(
      (transport) => typeof transport === "string" && transport.length > 0,
    )
  );
}

export function isKeyPackageBackupEnvelopeWire(
  value: unknown,
): value is KeyPackageBackupEnvelopeWire {
  return (
    isPlainObject(value) &&
    hasPropertyValue(value, "format", KEY_PACKAGE_BACKUP_ENVELOPE_FORMAT) &&
    hasPropertyValue(value, "version", 1) &&
    hasPropertyValue(
      value,
      "encryptionSuite",
      KEY_PACKAGE_BACKUP_ENCRYPTION_SUITE,
    ) &&
    hasNonEmptyStringProperty(value, "ciphertext") &&
    hasNonEmptyStringProperty(value, "iv")
  );
}
