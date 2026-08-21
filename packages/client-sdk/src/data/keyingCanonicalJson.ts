import type { KeyingCanonicalJson } from "@symcrypt/crypto";
import { serializeKeyingCanonicalJson } from "@symcrypt/crypto";
import { isPlainObject } from "@symcrypt/validators/isPlainObject";

interface CanonicalJsonFrame {
  leave?: object;
  value?: unknown;
}

function isCanonicalJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function pushCanonicalJsonChildren(
  value: unknown,
  active: WeakSet<object>,
  pending: CanonicalJsonFrame[],
): boolean {
  if (Array.isArray(value)) {
    if (active.has(value)) {
      return false;
    }
    active.add(value);
    pending.push({ leave: value });
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        return false;
      }
      pending.push({ value: value[index] });
    }
    return true;
  }

  if (!isPlainObject(value)) {
    return false;
  }
  if (active.has(value)) {
    return false;
  }
  active.add(value);
  pending.push({ leave: value });
  for (const key of Object.keys(value)) {
    pending.push({ value: Reflect.get(value, key) });
  }
  return true;
}

function isCanonicalJson(value: unknown): value is KeyingCanonicalJson {
  const pending: CanonicalJsonFrame[] = [{ value }];
  const active = new WeakSet<object>();

  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) {
      break;
    }
    if (frame.leave) {
      active.delete(frame.leave);
      continue;
    }

    const item = frame.value;
    if (isCanonicalJsonScalar(item)) {
      continue;
    }
    if (!pushCanonicalJsonChildren(item, active, pending)) {
      return false;
    }
  }

  return true;
}

export function readCanonicalJson(
  value: unknown,
  label: string,
): KeyingCanonicalJson {
  if (!isCanonicalJson(value)) {
    throw new Error(`${label} must be canonical JSON`);
  }
  return value;
}

export function readCanonicalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  readCanonicalJson(value, label);
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
  return serializeKeyingCanonicalJson(readCanonicalJson(value, label));
}
