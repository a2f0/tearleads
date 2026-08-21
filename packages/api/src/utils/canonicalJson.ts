import type { KeyingCanonicalJson } from "@symcrypt/crypto";
import { serializeKeyingCanonicalJson } from "@symcrypt/crypto";
import { isPlainObject } from "@symcrypt/validators/isPlainObject";

interface CanonicalJsonFrame {
  readonly leave?: object;
  readonly value?: unknown;
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

  if (!isPlainObject(value) || active.has(value)) {
    return false;
  }
  active.add(value);
  pending.push({ leave: value });
  for (const key of Object.keys(value)) {
    pending.push({ value: Reflect.get(value, key) });
  }
  return true;
}

export function isKeyingCanonicalJson(
  value: unknown,
): value is KeyingCanonicalJson {
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

    if (isCanonicalJsonScalar(frame.value)) {
      continue;
    }

    if (!pushCanonicalJsonChildren(frame.value, active, pending)) {
      return false;
    }
  }

  return true;
}

export function readKeyingCanonicalJson(
  value: unknown,
  label: string,
): KeyingCanonicalJson {
  if (!isKeyingCanonicalJson(value)) {
    throw new Error(`${label} must be canonical JSON`);
  }

  return value;
}

export function canonicalJsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (!isKeyingCanonicalJson(left) || !isKeyingCanonicalJson(right)) {
    return false;
  }

  return (
    serializeKeyingCanonicalJson(left) === serializeKeyingCanonicalJson(right)
  );
}
