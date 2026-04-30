import {
  type AccessEventTypeV2,
  type AccessEventV2,
  type AccessObjectKindV2,
  CONTENT_RECORD_ENCRYPTION_SUITE_V2,
  type ContainerKeyEpochV2,
  type ContentObjectKindV2,
  type WriteHeaderV2,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

function isAccessEventTypeV2(value: unknown): value is AccessEventTypeV2 {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function isAccessObjectKindV2(value: unknown): value is AccessObjectKindV2 {
  return value === "blob" || value === "container" || value === "document";
}

function isContentObjectKindV2(value: unknown): value is ContentObjectKindV2 {
  return value === "blob" || value === "document";
}

function hasNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = Reflect.get(record, key);
  return typeof value === "string" && value.length > 0;
}

function hasNullableString(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = Reflect.get(record, key);
  return value === null || typeof value === "string";
}

function hasPositiveInteger(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = Reflect.get(record, key);
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasStringArray(record: Record<string, unknown>, key: string): boolean {
  const value = Reflect.get(record, key);
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isAccessEventV2(value: unknown): value is AccessEventV2 {
  return (
    isPlainObject(value) &&
    Reflect.get(value, "version") === 2 &&
    hasNonEmptyString(value, "eventId") &&
    isAccessEventTypeV2(Reflect.get(value, "eventType")) &&
    isAccessObjectKindV2(Reflect.get(value, "objectKind")) &&
    hasNonEmptyString(value, "objectId") &&
    hasNonEmptyString(value, "organizationId") &&
    hasNullableString(value, "previousManifestHash") &&
    hasStringArray(value, "dependencyManifestHashes") &&
    hasNonEmptyString(value, "bodyHash") &&
    hasNonEmptyString(value, "signerUserId") &&
    hasNonEmptyString(value, "signerDeviceId") &&
    hasNonEmptyString(value, "signerKeyFingerprint") &&
    hasNonEmptyString(value, "signedAt") &&
    hasNonEmptyString(value, "signature")
  );
}

function isContainerKeyEpochV2(value: unknown): value is ContainerKeyEpochV2 {
  return (
    isPlainObject(value) &&
    hasNonEmptyString(value, "id") &&
    hasNonEmptyString(value, "containerId") &&
    hasPositiveInteger(value, "keyEpoch") &&
    hasNonEmptyString(value, "accessManifestHash") &&
    hasNullableString(value, "parentContainerKeyEpochId") &&
    hasNonEmptyString(value, "createdByEventHash") &&
    hasNonEmptyString(value, "createdByManifestHash")
  );
}

function isWriteHeaderV2(value: unknown): value is WriteHeaderV2 {
  return (
    isPlainObject(value) &&
    Reflect.get(value, "version") === 2 &&
    hasNonEmptyString(value, "organizationId") &&
    isContentObjectKindV2(Reflect.get(value, "objectKind")) &&
    hasNonEmptyString(value, "objectId") &&
    hasNonEmptyString(value, "accessManifestHash") &&
    hasPositiveInteger(value, "contentKeyEpoch") &&
    hasNonEmptyString(value, "targetHash") &&
    Reflect.get(value, "encryptionSuite") ===
      CONTENT_RECORD_ENCRYPTION_SUITE_V2 &&
    hasNonEmptyString(value, "contentRecordId") &&
    hasNonEmptyString(value, "nonceDomainHash") &&
    hasNonEmptyString(value, "metadataHash") &&
    hasNonEmptyString(value, "ciphertextHash") &&
    hasNonEmptyString(value, "writerUserId") &&
    hasNonEmptyString(value, "writerDeviceId") &&
    hasNonEmptyString(value, "writerKeyFingerprint") &&
    hasNonEmptyString(value, "signedAt") &&
    hasNonEmptyString(value, "signature")
  );
}

export function assertAccessEventV2(
  value: unknown,
  label: string,
): AccessEventV2 {
  if (!isAccessEventV2(value)) {
    throw new Error(`Expected ${label} to be an AccessEventV2.`);
  }

  return value;
}

export function assertContainerKeyEpochV2(
  value: unknown,
  label: string,
): ContainerKeyEpochV2 {
  if (!isContainerKeyEpochV2(value)) {
    throw new Error(`Expected ${label} to be a ContainerKeyEpochV2.`);
  }

  return value;
}

export function assertOptionalWriteHeaderV2(
  value: unknown,
  label: string,
): WriteHeaderV2 | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertWriteHeaderV2(value, label);
}

export function assertWriteHeaderV2(
  value: unknown,
  label: string,
): WriteHeaderV2 {
  if (!isWriteHeaderV2(value)) {
    throw new Error(`Expected ${label} to be a WriteHeaderV2.`);
  }

  return value;
}
