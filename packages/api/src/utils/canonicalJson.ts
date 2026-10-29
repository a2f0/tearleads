import {
  isKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";

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
