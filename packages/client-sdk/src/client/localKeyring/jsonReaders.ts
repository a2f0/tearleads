import type { LocalKeyPurpose } from "./types";

type ParsedObject = ReadonlyMap<string, unknown>;

export function readObject(value: unknown, label: string): ParsedObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return new Map(Object.entries(value));
}

export function readString(value: ParsedObject, key: string): string {
  const field = value.get(key);
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  return field;
}

export function readExactString<const ExpectedValue extends string>(
  value: ParsedObject,
  key: string,
  expectedValue: ExpectedValue,
): ExpectedValue {
  const field = readString(value, key);
  if (field !== expectedValue) {
    throw new Error(`${key} must be ${expectedValue}.`);
  }

  return expectedValue;
}

export function readLocalKeyPurpose(
  value: ParsedObject,
  key: string,
): LocalKeyPurpose {
  return readString(value, key);
}

export function readOptionalString(
  value: ParsedObject,
  key: string,
): string | undefined {
  const field = value.get(key);
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  return field;
}

export function readNullableString(
  value: ParsedObject,
  key: string,
): string | null {
  const field = value.get(key);
  if (field === null) {
    return null;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string or null.`);
  }

  return field;
}

export function readVersion1(value: ParsedObject): 1 {
  if (value.get("version") !== 1) {
    throw new Error("version must be 1.");
  }

  return 1;
}
