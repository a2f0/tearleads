import type { KeyingCanonicalJson } from "@symcrypt/crypto";
import { isPlainObject } from "@symcrypt/validators/isPlainObject";

function isCanonicalJson(value: unknown): value is KeyingCanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isCanonicalJson(value[index])) {
        return false;
      }
    }
    return true;
  }
  return (
    isPlainObject(value) &&
    Object.values(value).every(
      (item) => item !== undefined && isCanonicalJson(item),
    )
  );
}

export function toWireJson(value: unknown, label: string): KeyingCanonicalJson {
  if (!isCanonicalJson(value)) {
    throw new Error(`${label} fixture is not canonical JSON`);
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error(`${label} fixture cannot be serialized to JSON`);
  }
  const parsed: unknown = JSON.parse(serialized);
  if (!isCanonicalJson(parsed)) {
    throw new Error(`${label} fixture did not round-trip as canonical JSON`);
  }
  return parsed;
}

export function toWireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const parsed = toWireJson(value, label);
  if (!isPlainObject(parsed)) {
    throw new Error(`${label} fixture must serialize to a JSON object`);
  }
  return parsed;
}

export function toWireRecords(
  values: readonly unknown[],
  label: string,
): Record<string, unknown>[] {
  return values.map((value, index) =>
    toWireRecord(value, `${label}[${index}]`),
  );
}
