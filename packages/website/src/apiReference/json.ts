/**
 * Narrowing helpers for reading docs/openapi.json without type assertions.
 * Each throws with the JSON location, so a document the reference cannot
 * read fails the build instead of rendering a partial page.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRecord(value: unknown, where: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${where}: expected an object`);
  return value;
}

export function readString(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where}: expected a string`);
  return value;
}

export function readOptionalString(
  value: unknown,
  where: string,
): string | undefined {
  return value === undefined ? undefined : readString(value, where);
}

export function readBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${where}: expected a boolean`);
  }
  return value;
}

export function readArray(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`);
  return value;
}

export function readStringArray(
  value: unknown,
  where: string,
): readonly string[] {
  return readArray(value, where).map((item, index) =>
    readString(item, `${where}[${index}]`),
  );
}

/** Throws on a key the reference does not know how to present. */
export function assertKnownKeys(
  value: JsonRecord,
  known: ReadonlySet<string>,
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      throw new Error(`${where}: unsupported key "${key}"`);
    }
  }
}
