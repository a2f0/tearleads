import {
  type AccessEvent,
  type AccessEventType,
  type AccessObjectKind,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type ContentObjectKind,
  type WriteHeader,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

function isAccessEventType(value: unknown): value is AccessEventType {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.recite" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function isAccessObjectKind(value: unknown): value is AccessObjectKind {
  return value === "blob" || value === "container" || value === "document";
}

function isContentObjectKind(value: unknown): value is ContentObjectKind {
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

function isAccessEvent(value: unknown): value is AccessEvent {
  return (
    isPlainObject(value) &&
    Reflect.get(value, "version") === 1 &&
    hasNonEmptyString(value, "eventId") &&
    isAccessEventType(Reflect.get(value, "eventType")) &&
    isAccessObjectKind(Reflect.get(value, "objectKind")) &&
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

function isWriteHeader(value: unknown): value is WriteHeader {
  return (
    isPlainObject(value) &&
    Reflect.get(value, "version") === 1 &&
    hasNonEmptyString(value, "organizationId") &&
    isContentObjectKind(Reflect.get(value, "objectKind")) &&
    hasNonEmptyString(value, "objectId") &&
    hasNonEmptyString(value, "accessManifestHash") &&
    hasPositiveInteger(value, "contentKeyEpoch") &&
    hasNonEmptyString(value, "targetHash") &&
    Reflect.get(value, "encryptionSuite") === CONTENT_RECORD_ENCRYPTION_SUITE &&
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

export function assertAccessEvent(value: unknown, label: string): AccessEvent {
  if (!isAccessEvent(value)) {
    throw new Error(`Expected ${label} to be an AccessEvent.`);
  }

  return value;
}

export function assertOptionalWriteHeader(
  value: unknown,
  label: string,
): WriteHeader | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertWriteHeader(value, label);
}

export function assertWriteHeader(value: unknown, label: string): WriteHeader {
  if (!isWriteHeader(value)) {
    throw new Error(`Expected ${label} to be a WriteHeader.`);
  }

  return value;
}
