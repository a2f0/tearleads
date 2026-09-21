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

const REPORTED_UNEXPECTED_KEYS = 3;
const REPORTED_KEY_LENGTH = 32;

/**
 * Names at most a few offending keys, each truncated. The record is parsed
 * from untrusted bytes bounded only by the header limit, so echoing every key
 * back would put kilobytes of caller-chosen text into an error and its logs.
 */
export function assertOnlyRecordKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  const unexpectedKeys = Object.keys(record).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unexpectedKeys.length === 0) return;
  const named = unexpectedKeys
    .slice(0, REPORTED_UNEXPECTED_KEYS)
    .map((key) => JSON.stringify(key.slice(0, REPORTED_KEY_LENGTH)))
    .join(",");
  const remaining = unexpectedKeys.length - REPORTED_UNEXPECTED_KEYS;
  throw new Error(
    `${label} has unexpected keys: ${named}${
      remaining > 0 ? ` and ${remaining} more` : ""
    }`,
  );
}
