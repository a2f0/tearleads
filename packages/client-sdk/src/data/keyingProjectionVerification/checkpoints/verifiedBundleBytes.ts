import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";

// The exact bytes each manifest was verified from, keyed by the verified
// result. A later projection can hit the same verified hash while serving
// different bytes; only bytes that were themselves verified may be stored
// for citation.
const verifiedBundleBytes = new WeakMap<object, string>();

function canonicalBytes(bundle: unknown): string | null {
  try {
    return serializeKeyingCanonicalJson(
      readKeyingCanonicalJson(bundle, "Verified manifest bundle"),
    );
  } catch {
    return null;
  }
}

/** Remember the bundle a fresh verification accepted for `verified`. */
export function recordVerifiedBundleBytes(
  verified: object,
  bundle: unknown,
): void {
  const bytes = canonicalBytes(bundle);
  if (bytes !== null) verifiedBundleBytes.set(verified, bytes);
}

/** Whether `bundle` is byte-identical to the one `verified` came from. */
export function matchesVerifiedBundleBytes(
  verified: object,
  bundle: unknown,
): boolean {
  const recorded = verifiedBundleBytes.get(verified);
  return recorded !== undefined && recorded === canonicalBytes(bundle);
}
