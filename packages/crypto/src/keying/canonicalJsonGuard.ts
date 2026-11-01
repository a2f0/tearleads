import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { computeKeyingDomainHash } from "./canonical";
import type { KeyingCanonicalJson } from "./types";

/*
 * Shape guard shared by the API and the client SDK for untrusted values that
 * become KeyingCanonicalJson: finite scalars, dense arrays, and plain objects,
 * with no reference cycles. It checks shape only; serializeKeyingCanonicalJson
 * still rejects negative zero, ill-formed Unicode, and undefined properties.
 */

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

/**
 * Domain-separated SHA-256 hex of a container KEK level's canonical wire JSON
 * (`tearleads.keying.container-kek-level-citation`), its manifest history
 * cited by hash: the digest a projection request cites the level by (`k:`
 * hint). The domain keeps it apart from every other keying hash that shares
 * the client's citation cache key space. Null when the level is not canonical
 * JSON, so it is never cited and always travels.
 */
export async function computeContainerKekLevelDigest(
  level: unknown,
): Promise<string | null> {
  if (!isKeyingCanonicalJson(level)) return null;
  try {
    return await computeKeyingDomainHash(
      "tearleads.keying.container-kek-level-citation",
      level,
    );
  } catch {
    return null;
  }
}
