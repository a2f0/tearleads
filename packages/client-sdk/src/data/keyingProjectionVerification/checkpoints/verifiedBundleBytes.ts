import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import {
  isServedAccessManifestBundleWireResponse,
  type ServedAccessManifestBundleWireResponse,
  toServedAccessManifestBundle,
} from "@tearleads/validators/util";

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

// Each bundle object already found identical to a verified result, so a deep
// path, whose descendants all ask about the same ancestors, serializes each
// bundle once per verified result. What is stored for citation is never read
// from the object again (`verifiedServedSnapshot`), so a later change to it
// cannot be stored as verified.
const confirmedCopies = new WeakMap<object, object>();

/** Whether `bundle` is byte-identical to the one `verified` came from. */
export function matchesVerifiedBundleBytes(
  verified: object,
  bundle: AccessManifestBundleWireResponse,
): boolean {
  if (confirmedCopies.get(bundle) === verified) return true;
  const recorded = verifiedBundleBytes.get(verified);
  const matches = recorded !== undefined && recorded === canonicalBytes(bundle);
  if (matches) confirmedCopies.set(bundle, verified);
  return matches;
}

/**
 * The served bytes `verified` came from, when `bundle` is a copy of them,
 * rebuilt from the recorded bytes rather than read from `bundle`: what is
 * stored for citation is exactly what verification saw.
 */
export function verifiedServedSnapshot(
  verified: object,
  bundle: AccessManifestBundleWireResponse,
): ServedAccessManifestBundleWireResponse | null {
  const recorded = verifiedBundleBytes.get(verified);
  if (recorded === undefined || !matchesVerifiedBundleBytes(verified, bundle))
    return null;
  const snapshot: unknown = JSON.parse(recorded);
  return isServedAccessManifestBundleWireResponse(snapshot) ? snapshot : null;
}
