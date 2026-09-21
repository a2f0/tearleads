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

export function readRecordPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return value;
}

export function assertOnlyRecordKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  const unexpectedKeys = Object.keys(record).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `${label} has unexpected keys: ${unexpectedKeys.join(",")}`,
    );
  }
}
