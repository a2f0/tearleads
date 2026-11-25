// Shape checks shared by the seed spec validators.

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function strings(value: unknown): boolean {
  return (
    record(value) &&
    Object.values(value).every((field) => typeof field === "string")
  );
}

export function optionalArray(
  value: unknown,
  valid: (item: unknown) => boolean,
): boolean {
  return value === undefined || (Array.isArray(value) && value.every(valid));
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function distinct(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}
