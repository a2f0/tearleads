export function hasStringProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string> {
  return typeof value[key] === "string";
}

export function hasNumberProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, number> {
  return typeof value[key] === "number";
}

export function hasBooleanProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, boolean> {
  return typeof value[key] === "boolean";
}

export function hasNullableNumberProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, number | null> {
  return typeof value[key] === "number" || value[key] === null;
}

export function hasOptionalStringProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string | undefined> {
  return value[key] === undefined || typeof value[key] === "string";
}

export function hasArrayProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, unknown[]> {
  return Array.isArray(value[key]);
}

export function hasObjectProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, Record<string, unknown>> {
  const v = value[key];
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function hasPropertyValue<Key extends string, ExactValue>(
  value: Record<string, unknown>,
  key: Key,
  expected: ExactValue,
): value is Record<string, unknown> & Record<Key, ExactValue> {
  return value[key] === expected;
}
