import {
  KeyingVerificationError,
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";

// The exact bundle each manifest was verified from (signed event, body,
// manifest and the completed state), keyed by the verified result. A later
// projection can hit the same verified hash with different bytes or a
// different completed state; only what was itself verified may answer from
// the cache or be stored for citation (in its served form).
const verifiedBundleBytes = new WeakMap<object, string>();

function canonicalBytes(
  bundle: AccessManifestBundleWireResponse,
): string | null {
  try {
    return serializeKeyingCanonicalJson(
      readKeyingCanonicalJson(
        {
          event: bundle.event,
          manifest: bundle.manifest,
          manifestHash: bundle.manifestHash,
          state: bundle.state,
        },
        "Verified manifest bundle",
      ),
    );
  } catch {
    return null;
  }
}

/** Plain-data equality that keeps distinctions JSON cannot carry (`-0`). */
function sameData(left: unknown, right: unknown): boolean {
  if (typeof left !== "object" || left === null) return Object.is(left, right);
  if (typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameData(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
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
  snapshot?: AccessManifestBundleWireResponse,
): void {
  // A bundle that could not be serialized was never recorded (nor stored for
  // citation): it must equal the copy verification checked, and it is frozen
  // all the same, so it stays that copy.
  const unchanged = verifiedBundleBytes.has(verified)
    ? matchesVerifiedBundleBytes(verified, bundle)
    : snapshot !== undefined && sameData(bundle, snapshot);
  if (unchanged && !verifiedBundleBytes.has(verified) && isPlainData(bundle))
    deepFreeze(bundle);
  if (!unchanged) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      `${label} changed while it was verified`,
    );
  }
}
