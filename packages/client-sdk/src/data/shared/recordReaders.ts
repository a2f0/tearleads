/**
 * The one family of labeled record readers for wire and stored payloads.
 * Every domain previously carried private copies whose names collided while
 * their semantics drifted (a plain lookup here, a throw-on-missing lookup
 * there, and "number" sometimes meaning "positive integer"). The vocabulary
 * is now explicit: value lookups are plain unless named required, and
 * integer readers say exactly which integers they accept.
 */
export function readRecordValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return record[key];
}

export function readRequiredRecordValue(
  record: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  if (!Object.hasOwn(record, key)) {
    throw new Error(`${label}.${key} is missing`);
  }
  return record[key];
}

export function readRecordString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

export function readRecordNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string or null`);
  }
  return value;
}

export function readRecordInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label}.${key} must be an integer`);
  }
  return value;
}

export function readRecordPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return value;
}

export function readRecordSafePositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}.${key} must be a positive safe integer`);
  }
  return value;
}

export function readRecordSafeByteLength(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}.${key} must be a non-negative safe integer`);
  }
  return value;
}

export function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a string array`);
  }
  // Materialize exactly once and validate the copy that is returned:
  // Array.from surfaces holes as undefined (a bare `some` skips them), and a
  // stateful iterator cannot swap entries between validation and return.
  const entries: unknown[] = Array.from(value);
  if (
    !entries.every(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    )
  ) {
    throw new Error(`${label} must be a string array`);
  }

  return entries;
}
