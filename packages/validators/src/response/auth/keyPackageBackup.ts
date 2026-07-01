import { isPlainObject } from "../../isPlainObject";
import {
  hasNonEmptyStringProperty,
  hasNumberProperty,
  hasPropertyValue,
} from "../../util";
import {
  isKeyPackageBackupCredentialWire,
  isKeyPackageBackupEnvelopeWire,
  KEY_PACKAGE_BACKUP_KDF_SUITE,
  type KeyPackageBackupCredentialWire,
  type KeyPackageBackupEnvelopeWire,
} from "../../util/keyPackageBackup";

export interface KeyPackageBackupResponse {
  readonly backupId: string;
  readonly backupVersion: number;
  readonly createdAt: string;
  readonly credential: KeyPackageBackupCredentialWire;
  readonly envelope: KeyPackageBackupEnvelopeWire;
  readonly kdfSuite: typeof KEY_PACKAGE_BACKUP_KDF_SUITE;
  readonly prfSalt: string;
  readonly prfSaltVersion: 1;
  readonly signingKeyFingerprint: string;
  readonly updatedAt: string;
}

export interface ListKeyPackageBackupsResponse {
  readonly backups: readonly KeyPackageBackupResponse[];
}

export interface DeleteKeyPackageBackupResponse {
  readonly message: "ok";
}

export function isKeyPackageBackupResponse(
  value: unknown,
): value is KeyPackageBackupResponse {
  return (
    isPlainObject(value) &&
    hasNonEmptyStringProperty(value, "backupId") &&
    hasNonEmptyStringProperty(value, "signingKeyFingerprint") &&
    hasPropertyValue(value, "kdfSuite", KEY_PACKAGE_BACKUP_KDF_SUITE) &&
    hasNonEmptyStringProperty(value, "prfSalt") &&
    hasPropertyValue(value, "prfSaltVersion", 1) &&
    hasNumberProperty(value, "backupVersion") &&
    Number.isInteger(value.backupVersion) &&
    value.backupVersion >= 1 &&
    hasNonEmptyStringProperty(value, "createdAt") &&
    hasNonEmptyStringProperty(value, "updatedAt") &&
    isKeyPackageBackupCredentialWire(Reflect.get(value, "credential")) &&
    isKeyPackageBackupEnvelopeWire(Reflect.get(value, "envelope"))
  );
}

export function isListKeyPackageBackupsResponse(
  value: unknown,
): value is ListKeyPackageBackupsResponse {
  const backups = isPlainObject(value) ? Reflect.get(value, "backups") : null;
  return (
    isPlainObject(value) &&
    Array.isArray(backups) &&
    backups.every(isKeyPackageBackupResponse)
  );
}

export function isDeleteKeyPackageBackupResponse(
  value: unknown,
): value is DeleteKeyPackageBackupResponse {
  return isPlainObject(value) && hasPropertyValue(value, "message", "ok");
}
