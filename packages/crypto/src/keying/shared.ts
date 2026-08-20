import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  type AccessEventType,
  type AccessObjectKind,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type ContainerAccessLevel,
  type ContainerGrantSubjectType,
  type ContentObjectKind,
  type ContentRecordEncryptionSuite,
  type KekRecipientKind,
  type KeyingVerificationCode,
  KeyingVerificationError,
  type KeyingVerificationResult,
  type ManagedPrincipalKind,
} from "./types";

export function ok<T>(value: T): KeyingVerificationResult<T> {
  return { ok: true, value };
}

function fail<T>(
  code: KeyingVerificationCode,
  message: string,
): KeyingVerificationResult<T> {
  return {
    ok: false,
    error: new KeyingVerificationError(code, message),
  };
}

export function throwVerification(
  code: KeyingVerificationCode,
  message: string,
): never {
  throw new KeyingVerificationError(code, message);
}

export function toVerificationResult<T>(
  error: unknown,
): KeyingVerificationResult<T> {
  if (error instanceof KeyingVerificationError) {
    return { ok: false, error };
  }

  return fail(
    "invalid_shape",
    error instanceof Error ? error.message : String(error),
  );
}

export async function runVerifier<T>(
  operation: () => Promise<T>,
): Promise<KeyingVerificationResult<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    return toVerificationResult(error);
  }
}

export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertExactKeys<const ExpectedKeys extends readonly string[]>(
  value: unknown,
  expectedKeys: ExpectedKeys,
  label: string,
): Record<ExpectedKeys[number], unknown> {
  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", `${label} must be a plain object`);
  }

  const actualKeys = [
    ...Object.getOwnPropertyNames(value),
    ...Object.getOwnPropertySymbols(value).map(String),
  ].sort(compareCanonicalStrings);
  const sortedExpectedKeys = [...expectedKeys].sort(compareCanonicalStrings);

  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throwVerification(
      "invalid_shape",
      `${label} has unexpected keys: ${actualKeys.join(",")}`,
    );
  }

  return value;
}

export function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throwVerification("invalid_shape", `${label}.${key} must be a string`);
  }

  return value;
}

export function readNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length === 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be null or string`,
    );
  }

  return value;
}

export function readHashString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);

  if (!/^[0-9a-f]{64}$/.test(value)) {
    throwVerification(
      "hash_mismatch",
      `${label}.${key} must be a 64-character lowercase hex hash`,
    );
  }

  return value;
}

export function readContentRecordId(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label).toLowerCase();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be a UUIDv4 content record id`,
    );
  }

  return value;
}

export function readNullableHashString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throwVerification(
      "hash_mismatch",
      `${label}.${key} must be null or a 64-character lowercase hex hash`,
    );
  }

  return value;
}

export function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];

  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be a positive integer`,
    );
  }

  return value;
}

export function readNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];

  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be a non-negative integer`,
    );
  }

  return value;
}

export function readVersion(
  record: { readonly version: unknown },
  label: string,
): 1 {
  const value = record.version;

  if (value !== 1) {
    throwVerification("invalid_domain", `${label}.version must be 1`);
  }

  return 1;
}

export function readSignedAt(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);

  if (Number.isNaN(new Date(value).valueOf())) {
    throwVerification("invalid_shape", `${label}.${key} must be a timestamp`);
  }

  return value;
}

export function readStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const value = record[key];

  if (!Array.isArray(value)) {
    throwVerification("invalid_shape", `${label}.${key} must be an array`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      throwVerification(
        "invalid_shape",
        `${label}.${key}[${index}] must be a string`,
      );
    }

    return item;
  });
}

export function normalizeUniqueSortedStrings(
  values: readonly string[],
  label: string,
): string[] {
  const sortedValues = [...values].sort(compareCanonicalStrings);

  for (let index = 1; index < sortedValues.length; index += 1) {
    if (sortedValues[index - 1] === sortedValues[index]) {
      throwVerification("duplicate_entry", `${label} contains a duplicate`);
    }
  }

  return sortedValues;
}

function isAccessEventType(value: string): value is AccessEventType {
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

function isAccessObjectKind(value: string): value is AccessObjectKind {
  return value === "blob" || value === "container" || value === "document";
}

function isManagedPrincipalKind(value: string): value is ManagedPrincipalKind {
  return value === "group" || value === "organization";
}

function isKekRecipientKind(value: string): value is KekRecipientKind {
  return value === "container" || value === "group" || value === "user";
}

function isContentObjectKind(value: string): value is ContentObjectKind {
  return value === "blob" || value === "document";
}

function isContainerAccessLevel(value: string): value is ContainerAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: string,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "user";
}

export function expectedObjectKindForEventType(
  eventType: AccessEventType,
): AccessObjectKind {
  if (eventType.startsWith("container.")) {
    return "container";
  }

  if (eventType.startsWith("document.")) {
    return "document";
  }

  return "blob";
}

export function normalizeAccessEventType(
  value: unknown,
  label: string,
): AccessEventType {
  if (typeof value !== "string" || !isAccessEventType(value)) {
    throwVerification("invalid_domain", `${label}.eventType is unsupported`);
  }

  return value;
}

export function normalizeAccessObjectKind(
  value: unknown,
  label: string,
): AccessObjectKind {
  if (typeof value !== "string" || !isAccessObjectKind(value)) {
    throwVerification("invalid_domain", `${label}.objectKind is unsupported`);
  }

  return value;
}

export function normalizeManagedPrincipalKind(
  value: unknown,
  label: string,
): ManagedPrincipalKind {
  if (typeof value !== "string" || !isManagedPrincipalKind(value)) {
    throwVerification(
      "invalid_domain",
      `${label}.principalType is unsupported`,
    );
  }

  return value;
}

export function normalizeKekRecipientKind(
  value: unknown,
  label: string,
): KekRecipientKind {
  if (typeof value !== "string" || !isKekRecipientKind(value)) {
    throwVerification(
      "invalid_domain",
      `${label}.recipientKind is unsupported`,
    );
  }

  return value;
}

export function normalizeContentObjectKind(
  value: unknown,
  label: string,
): ContentObjectKind {
  if (typeof value !== "string" || !isContentObjectKind(value)) {
    throwVerification("invalid_domain", `${label}.objectKind is unsupported`);
  }

  return value;
}

export function normalizeContentRecordEncryptionSuite(
  value: unknown,
  label: string,
): ContentRecordEncryptionSuite {
  if (value !== CONTENT_RECORD_ENCRYPTION_SUITE) {
    throwVerification(
      "invalid_domain",
      `${label}.encryptionSuite is unsupported`,
    );
  }

  return value;
}

export function normalizeContainerAccessLevel(
  value: unknown,
  label: string,
): ContainerAccessLevel {
  if (typeof value !== "string" || !isContainerAccessLevel(value)) {
    throwVerification("invalid_domain", `${label}.accessLevel is unsupported`);
  }

  return value;
}

export function normalizeContainerGrantSubjectType(
  value: unknown,
  label: string,
): ContainerGrantSubjectType {
  if (typeof value !== "string" || !isContainerGrantSubjectType(value)) {
    throwVerification("invalid_domain", `${label}.subjectType is unsupported`);
  }

  return value;
}

export function readHashArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throwVerification("invalid_shape", `${label} must be an array`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item)) {
      throwVerification(
        "hash_mismatch",
        `${label}[${index}] must be a 64-character lowercase hex hash`,
      );
    }

    return item;
  });
}

export function normalizeSortedUniqueArray<T>(
  values: readonly unknown[],
  normalize: (value: unknown) => T,
  key: (value: T) => string,
  label: string,
): T[] {
  const normalizedValues = values
    .map(normalize)
    .sort((left, right) => compareCanonicalStrings(key(left), key(right)));

  let previousKey: string | null = null;
  for (const normalizedValue of normalizedValues) {
    const normalizedKey = key(normalizedValue);
    if (previousKey === normalizedKey) {
      throwVerification("duplicate_entry", `${label} contains a duplicate`);
    }
    previousKey = normalizedKey;
  }

  return normalizedValues;
}
