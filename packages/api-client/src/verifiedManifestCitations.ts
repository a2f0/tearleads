import {
  type AccessManifestBundleWireResponse,
  isAccessManifestBundleWireResponse,
} from "@tearleads/validators/response";
import {
  isSha256HexString,
  KNOWN_MANIFEST_HINT_LIMIT,
} from "@tearleads/validators/util";

/** Citation only saves bytes: a source slower than this sends the read uncited. */
export const MANIFEST_CITATION_DEADLINE_MS = 250;

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
 * The source's answer, or nothing once the deadline passes, the caller
 * aborts, or the source throws or rejects. A late answer is discarded: it can
 * never reach a request that was already sent.
 */
function boundedCitation(
  source: VerifiedManifestCitations,
  target: WriterProjectionTarget,
  signal: AbortSignal | undefined,
): Promise<readonly unknown[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (bundles: readonly unknown[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abandon);
      resolve(bundles);
    };
    const abandon = () => finish([]);
    const timer = setTimeout(abandon, MANIFEST_CITATION_DEADLINE_MS);
    if (signal?.aborted) return abandon();
    signal?.addEventListener("abort", abandon, { once: true });
    try {
      source.cite(target).then(finish, abandon);
    } catch {
      abandon();
    }
  });
}

/**
 * The bytes one request cites, copied so a later eviction or mutation of the
 * source cannot change what fills its omissions. Citing only saves bytes, so
 * it never blocks or fails a read: a slow, failing, or abandoned source
 * yields no hints.
 */
export async function heldManifestCitations(
  source: VerifiedManifestCitations | null,
  target: WriterProjectionTarget,
  signal?: AbortSignal | undefined,
): Promise<Map<string, AccessManifestBundleWireResponse>> {
  const held = new Map<string, AccessManifestBundleWireResponse>();
  if (!source) return held;
  for (const bundle of await boundedCitation(source, target, signal)) {
    if (held.size >= KNOWN_MANIFEST_HINT_LIMIT) break;
    if (
      !isAccessManifestBundleWireResponse(bundle) ||
      !isSha256HexString(bundle.manifestHash) ||
      held.has(bundle.manifestHash)
    )
      continue;
    try {
      held.set(bundle.manifestHash, structuredClone(bundle));
    } catch {
      // An uncloneable entry is skipped; its manifest simply travels.
    }
  }
  return held;
}
