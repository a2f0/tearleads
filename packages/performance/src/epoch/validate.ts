export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`Expected object for ${label}.`);
  return value;
}

export function requireArray(
  record: Record<string, unknown>,
  field: string,
  path: string,
): readonly unknown[] {
  const value = Reflect.get(record, field);
  if (!Array.isArray(value)) {
    throw new Error(`${path} is missing array field '${field}'.`);
  }
  return value;
}

export function requireFiniteNumber(
  record: Record<string, unknown>,
  field: string,
  path: string,
): number {
  const value = Reflect.get(record, field);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} is missing finite numeric field '${field}'.`);
  }
  return value;
}

export function requireNullableFiniteNumber(
  record: Record<string, unknown>,
  field: string,
  path: string,
): number | null {
  const value = Reflect.get(record, field);
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} has invalid nullable numeric field '${field}'.`);
  }
  return value;
}

export function requireOptionalPositiveInt(
  record: Record<string, unknown>,
  field: string,
  path: string,
): number | undefined {
  const value = Reflect.get(record, field);
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} has invalid positive integer field '${field}'.`);
  }
  return value;
}

export function requireString(
  record: Record<string, unknown>,
  field: string,
  path: string,
): string {
  const value = Reflect.get(record, field);
  if (typeof value !== "string") {
    throw new Error(`${path} is missing string field '${field}'.`);
  }
  return value;
}

export function requireOptionalString(
  record: Record<string, unknown>,
  field: string,
  path: string,
): string | undefined {
  const value = Reflect.get(record, field);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${path} has invalid optional string field '${field}'.`);
  }
  return value;
}

export function requireNullableString(
  record: Record<string, unknown>,
  field: string,
  path: string,
): string | null {
  const value = Reflect.get(record, field);
  if (value !== null && typeof value !== "string") {
    throw new Error(`${path} has invalid nullable string field '${field}'.`);
  }
  return value;
}

export function requireBoolean(
  record: Record<string, unknown>,
  field: string,
  path: string,
): boolean {
  const value = Reflect.get(record, field);
  if (typeof value !== "boolean") {
    throw new Error(`${path} is missing boolean field '${field}'.`);
  }
  return value;
}

export function requireStringArray(
  record: Record<string, unknown>,
  field: string,
  path: string,
): readonly string[] {
  const arr = requireArray(record, field, path);
  return arr.map((item, idx) => {
    if (typeof item !== "string") {
      throw new Error(`${path} ${field}[${idx}] must be a string.`);
    }
    return item;
  });
}

export function requireNumberArray(
  record: Record<string, unknown>,
  field: string,
  path: string,
): readonly number[] {
  const arr = requireArray(record, field, path);
  return arr.map((item, idx) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(`${path} ${field}[${idx}] must be a finite number.`);
    }
    return item;
  });
}

export function requireRealtimePass(
  record: Record<string, unknown>,
  path: string,
): "declaration" | "revalidation" {
  const pass = requireString(record, "pass", path);
  if (pass !== "declaration" && pass !== "revalidation") {
    throw new Error(`${path} has invalid realtime pass '${pass}'.`);
  }
  return pass;
}
