import {
  KeyingVerificationError,
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { toServedAccessManifestBundle } from "@tearleads/validators/util";

// The exact served bytes each manifest was verified from, keyed by the
// verified result. A later projection can hit the same verified hash while
// serving different bytes; only bytes that were themselves verified may be
// stored for citation. The decoded state is rebuilt from these bytes, so it
// is neither compared nor stored.
const verifiedBundleBytes = new WeakMap<object, string>();

function canonicalBytes(
  bundle: AccessManifestBundleWireResponse,
): string | null {
  try {
    return serializeKeyingCanonicalJson(
      readKeyingCanonicalJson(
        toServedAccessManifestBundle(bundle),
        "Verified manifest bundle",
      ),
    );
  } catch {
    return null;
  }
}

/** Remember the bundle a fresh verification accepted for `verified`. */
export function recordVerifiedBundleBytes(
  verified: object,
  bundle: AccessManifestBundleWireResponse,
): void {
  const bytes = canonicalBytes(bundle);
  if (bytes !== null) verifiedBundleBytes.set(verified, bytes);
}

// Bundles frozen here after they matched a verified result. A frozen bundle
// of plain data can no longer change, so every later comparison against the
// same result is answered without serializing it again, and a caller reading
// it reads exactly the bytes verification accepted.
const frozenMatches = new WeakMap<object, object>();

/** Whether every value under `value` is a plain data property. */
function isPlainData(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => "value" in descriptor && isPlainData(descriptor.value),
  );
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

/**
 * Whether `bundle` is byte-identical to the one `verified` came from. A
 * plain-data bundle that matches is frozen, so it stays the verified copy.
 */
export function matchesVerifiedBundleBytes(
  verified: object,
  bundle: AccessManifestBundleWireResponse,
): boolean {
  if (frozenMatches.get(bundle) === verified) return true;
  const recorded = verifiedBundleBytes.get(verified);
  const matches = recorded !== undefined && recorded === canonicalBytes(bundle);
  if (matches && isPlainData(bundle)) {
    deepFreeze(bundle);
    frozenMatches.set(bundle, verified);
  }
  return matches;
}

/**
 * Verification checks a copy taken before its first await; the caller reads
 * the bundle it passed, so on return that bundle must still be the copy
 * verification accepted.
 */
export function assertUnchangedSinceVerification(
  verified: object,
  bundle: AccessManifestBundleWireResponse,
  label: string,
): void {
  // Bytes that could not be serialized were never recorded (nor stored for
  // citation); the completed state check still covers such a bundle.
  if (!verifiedBundleBytes.has(verified)) return;
  if (!matchesVerifiedBundleBytes(verified, bundle)) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      `${label} changed while it was verified`,
    );
  }
}
