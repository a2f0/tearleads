import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

export function readCanonicalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  readKeyingCanonicalJson(value, label);
  return value;
}

export function readCanonicalRecords(
  values: readonly unknown[],
  label: string,
): Record<string, unknown>[] {
  return values.map((value, index) =>
    readCanonicalRecord(value, `${label}[${index}]`),
  );
}

/**
 * Canonicalize-then-serialize, the one string form every keying equality
 * check compares. Both halves are shared already; composing them per-file
 * invited the composition itself to drift.
 */
export function canonicalKeyingJsonString(
  value: unknown,
  label: string,
): string {
  return serializeKeyingCanonicalJson(readKeyingCanonicalJson(value, label));
}
