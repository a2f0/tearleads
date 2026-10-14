import {
  type AccessManifestBundleWireResponse,
  isAccessManifestBundleWireResponse,
} from "@tearleads/validators/response";
import {
  isSha256HexString,
  KNOWN_MANIFEST_HINT_LIMIT,
} from "@tearleads/validators/util";

export interface WriterProjectionTarget {
  readonly kind: "container" | "document";
  readonly id: string;
}

/**
 * Verified access-manifest bundles a device durably holds that a writer
 * projection of `target` may cite, most useful first. This is never trust
 * input: the exact cited bytes only fill the response's omitted positions,
 * and the caller verifies the rebuilt projection exactly as a full one.
 */
export interface VerifiedManifestCitations {
  cite(
    target: WriterProjectionTarget,
  ): Promise<readonly AccessManifestBundleWireResponse[]>;
}

/**
 * The bytes one request cites, copied so a later eviction or mutation of the
 * source cannot change what fills its omissions. A citation failure only
 * costs bytes: the request then carries no hints.
 */
export async function heldManifestCitations(
  source: VerifiedManifestCitations | null,
  target: WriterProjectionTarget,
): Promise<Map<string, AccessManifestBundleWireResponse>> {
  const held = new Map<string, AccessManifestBundleWireResponse>();
  if (!source) return held;
  let bundles: readonly unknown[];
  try {
    bundles = await source.cite(target);
  } catch {
    return held;
  }
  for (const bundle of bundles) {
    if (held.size >= KNOWN_MANIFEST_HINT_LIMIT) break;
    if (
      isAccessManifestBundleWireResponse(bundle) &&
      isSha256HexString(bundle.manifestHash) &&
      !held.has(bundle.manifestHash)
    )
      held.set(bundle.manifestHash, structuredClone(bundle));
  }
  return held;
}
