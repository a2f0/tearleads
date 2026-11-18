import { computeContainerKekLevelDigest } from "@tearleads/crypto";
import {
  type ContainerKekWireLevel,
  isContainerKekWireLevel,
  type PrincipalStatePayloadResponse,
} from "@tearleads/validators/response";
import {
  isServedAccessManifestBundleWireResponse,
  isSha256HexString,
  KNOWN_DIRECTORY_HINT_LIMIT,
  KNOWN_MANIFEST_HINT_LIMIT,
  type ServedAccessManifestBundleWireResponse,
} from "@tearleads/validators/util";
import {
  type HeldDirectoryCitation,
  isHeldDirectoryCitation,
  signedDirectoryPayload,
} from "./heldDirectoryCitations";

export type { HeldDirectoryCitation } from "./heldDirectoryCitations";

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

/**
 * A held access-manifest bundle, a held container KEK level, or a held
 * organization directory payload with its signed state.
 */
export type HeldProjectionCitation =
  | ServedAccessManifestBundleWireResponse
  | ContainerKekWireLevel
  | HeldDirectoryCitation;

/**
 * Verified access-manifest bundles, container KEK levels and organization
 * directory payloads a device durably holds that a writer projection of
 * `target` may cite, most useful first.
 * This is never trust input: the exact cited bytes only fill the response's
 * omitted positions, and the caller verifies the rebuilt projection exactly
 * as a full one.
 */
export interface VerifiedManifestCitations {
  cite(
    target: WriterProjectionTarget,
  ): Promise<readonly HeldProjectionCitation[]>;
}

/**
 * The exact bytes one request cites: bundles by hash, levels by digest,
 * directory payloads by their organization state's hash.
 */
export interface HeldProjectionCitations {
  readonly bundles: Map<string, ServedAccessManifestBundleWireResponse>;
  readonly kekLevels: Map<string, ContainerKekWireLevel>;
  readonly directories: Map<string, PrincipalStatePayloadResponse>;
}

function noCitations(): HeldProjectionCitations {
  return { bundles: new Map(), kekLevels: new Map(), directories: new Map() };
}

/**
 * The prepared citations, or none once the deadline passes, the caller
 * aborts, or the source or preparation throws or rejects. A late answer is
 * discarded: it can never reach a request that was already sent.
 */
function boundedCitation(
  prepare: () => Promise<HeldProjectionCitations>,
  signal: AbortSignal | undefined,
): Promise<HeldProjectionCitations> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (held: HeldProjectionCitations) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abandon);
      resolve(held);
    };
    const abandon = () => finish(noCitations());
    const timer = setTimeout(abandon, MANIFEST_CITATION_DEADLINE_MS);
    if (signal?.aborted) return abandon();
    signal?.addEventListener("abort", abandon, { once: true });
    try {
      prepare().then(finish, abandon);
    } catch {
      abandon();
    }
  });
}

/** Copies of the source's entries, each kind within its own hint quota. */
function copyHeldEntries(entries: readonly unknown[]) {
  const bundles = new Map<string, ServedAccessManifestBundleWireResponse>();
  const levels: ContainerKekWireLevel[] = [];
  const directories: HeldDirectoryCitation[] = [];
  const manifestQuotaLeft = () =>
    bundles.size + levels.length < KNOWN_MANIFEST_HINT_LIMIT;
  for (const entry of entries) {
    try {
      if (isHeldDirectoryCitation(entry)) {
        if (directories.length < KNOWN_DIRECTORY_HINT_LIMIT)
          directories.push(structuredClone(entry));
      } else if (!manifestQuotaLeft()) continue;
      else if (isContainerKekWireLevel(entry))
        levels.push(structuredClone(entry));
      else if (
        isServedAccessManifestBundleWireResponse(entry) &&
        isSha256HexString(entry.manifestHash) &&
        !bundles.has(entry.manifestHash)
      )
        bundles.set(entry.manifestHash, structuredClone(entry));
    } catch {
      // An uncloneable entry is skipped; its bytes simply travel.
    }
  }
  return { bundles, levels, directories };
}

/**
 * Copies the source's answer and keys each KEK level by the digest
 * recomputed from its own bytes, never by a digest the source names. A
 * directory payload is cited only when it hashes to the payload hash its own
 * signed organization state commits.
 */
async function prepareHeldCitations(
  entries: readonly unknown[],
): Promise<HeldProjectionCitations> {
  const { bundles, levels, directories } = copyHeldEntries(entries);
  const held: HeldProjectionCitations = { ...noCitations(), bundles };
  const digests = await Promise.all(levels.map(computeContainerKekLevelDigest));
  levels.forEach((level, index) => {
    const digest = digests[index];
    if (digest && !held.kekLevels.has(digest))
      held.kekLevels.set(digest, level);
  });
  const payloads = await Promise.all(directories.map(signedDirectoryPayload));
  for (const signed of payloads)
    if (signed && !held.directories.has(signed.stateHash))
      held.directories.set(signed.stateHash, signed.payload);
  return held;
}

/**
 * The bytes one request cites, copied so a later eviction or mutation of the
 * source cannot change what fills its omissions. Citing only saves bytes, so
 * it never blocks or fails a read: a slow, failing, or abandoned source or
 * preparation yields no hints, within one deadline.
 */
export async function heldManifestCitations(
  source: VerifiedManifestCitations | null,
  target: WriterProjectionTarget,
  signal?: AbortSignal | undefined,
): Promise<HeldProjectionCitations> {
  if (!source) return noCitations();
  return boundedCitation(
    async () => prepareHeldCitations(await source.cite(target)),
    signal,
  );
}
