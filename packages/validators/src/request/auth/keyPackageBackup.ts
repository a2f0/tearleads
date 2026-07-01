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

export interface PutKeyPackageBackupRequest {
  readonly backupId: string;
  readonly backupVersion: number;
  readonly credential: KeyPackageBackupCredentialWire;
  readonly envelope: KeyPackageBackupEnvelopeWire;
  readonly kdfSuite: typeof KEY_PACKAGE_BACKUP_KDF_SUITE;
  readonly prfSalt: string;
  readonly prfSaltVersion: 1;
  readonly signingKeyFingerprint: string;
}

export function isPutKeyPackageBackupRequest(
  value: unknown,
): value is PutKeyPackageBackupRequest {
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
    isKeyPackageBackupCredentialWire(Reflect.get(value, "credential")) &&
    isKeyPackageBackupEnvelopeWire(Reflect.get(value, "envelope"))
  );
}
