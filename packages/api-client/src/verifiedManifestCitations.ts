import { computeContainerKekLevelDigest } from "@tearleads/crypto";
import {
  type AccessManifestBundleWireResponse,
  type ContainerKekWireLevel,
  isAccessManifestBundleWireResponse,
  isContainerKekWireLevel,
} from "@tearleads/validators/response";
import {
  isSha256HexString,
  KNOWN_MANIFEST_HINT_LIMIT,
} from "@tearleads/validators/util";

/** Citation only saves bytes: a source slower than this sends the read uncited. */
export const MANIFEST_CITATION_DEADLINE_MS = 250;

/**
 * Where a listing placed a container the device has not stored yet. Only
 * which held bytes a read cites depends on it, never what the read accepts.
 */
export interface WriterProjectionListing {
  readonly organizationId: string;
  readonly parentId: string | null;
}

export interface WriterProjectionTarget {
  readonly kind: "container" | "document";
  readonly id: string;
  readonly listing?: WriterProjectionListing | undefined;
}

/** A held access-manifest bundle or a held container KEK level. */
export type HeldProjectionCitation =
  | AccessManifestBundleWireResponse
  | ContainerKekWireLevel;

/**
 * Verified access-manifest bundles and container KEK levels a device durably
 * holds that a writer projection of `target` may cite, most useful first.
 * This is never trust input: the exact cited bytes only fill the response's
 * omitted positions, and the caller verifies the rebuilt projection exactly
 * as a full one.
 */
export interface VerifiedManifestCitations {
  cite(
    target: WriterProjectionTarget,
  ): Promise<readonly HeldProjectionCitation[]>;
}

/** The exact bytes one request cites: bundles by hash, levels by digest. */
export interface HeldProjectionCitations {
  readonly bundles: Map<string, AccessManifestBundleWireResponse>;
  readonly kekLevels: Map<string, ContainerKekWireLevel>;
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
 * source cannot change what fills its omissions. A level is keyed by the
 * digest recomputed here from its own bytes, never by a digest the source
 * names. Citing only saves bytes, so it never blocks or fails a read: a slow,
 * failing, or abandoned source yields no hints.
 */
export async function heldManifestCitations(
  source: VerifiedManifestCitations | null,
  target: WriterProjectionTarget,
  signal?: AbortSignal | undefined,
): Promise<HeldProjectionCitations> {
  const held: HeldProjectionCitations = {
    bundles: new Map(),
    kekLevels: new Map(),
  };
  if (!source) return held;
  const size = () => held.bundles.size + held.kekLevels.size;
  for (const entry of await boundedCitation(source, target, signal)) {
    if (size() >= KNOWN_MANIFEST_HINT_LIMIT) break;
    try {
      if (isContainerKekWireLevel(entry)) {
        const level = structuredClone(entry);
        const digest = await computeContainerKekLevelDigest(level);
        if (digest !== null && !held.kekLevels.has(digest))
          held.kekLevels.set(digest, level);
        continue;
      }
      if (
        !isAccessManifestBundleWireResponse(entry) ||
        !isSha256HexString(entry.manifestHash) ||
        held.bundles.has(entry.manifestHash)
      )
        continue;
      held.bundles.set(entry.manifestHash, structuredClone(entry));
    } catch {
      // An uncloneable entry is skipped; its bytes simply travel.
    }
  }
  return held;
}
