import {
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

// Each bundle object already found identical to a verified result. A
// projection's bundles are decoded once and never mutated, and a deep path
// asks about the same ancestors from every descendant, so each bundle is
// serialized and compared at most once per verified result.
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
