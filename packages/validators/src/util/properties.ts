import { isPlainObject } from "../isPlainObject";

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

export function hasPositiveIntegerProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, number> {
  return (
    hasNumberProperty(value, key) &&
    Number.isInteger(value[key]) &&
    value[key] > 0
  );
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

export function hasNonEmptyStringProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string> {
  return hasStringProperty(value, key) && value[key].length > 0;
}

export function hasNullableStringProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string | null> {
  return value[key] === null || typeof value[key] === "string";
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

export function isRecordArray(
  value: unknown,
): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

export function isRecordArrayArray(
  value: unknown,
): value is Record<string, unknown>[][] {
  return Array.isArray(value) && value.every(isRecordArray);
}

export function isOptionalRecordArray(
  value: unknown,
): value is Record<string, unknown>[] | undefined {
  return value === undefined || isRecordArray(value);
}

export function isOptionalRecordArrayArray(
  value: unknown,
): value is Record<string, unknown>[][] | undefined {
  return value === undefined || isRecordArrayArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

export function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}
