import type { KeyingCanonicalJson } from "@tearleads/crypto";
import { serializeKeyingCanonicalJson } from "@tearleads/crypto";

export function canonicalJsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  return (
    serializeKeyingCanonicalJson(left as KeyingCanonicalJson) ===
    serializeKeyingCanonicalJson(right as KeyingCanonicalJson)
  );
}
