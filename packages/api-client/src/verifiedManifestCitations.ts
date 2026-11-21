import { prepareHeldProjectionCitations } from "@tearleads/crypto";
import type {
  HeldProjectionCitation,
  HeldProjectionCitations,
  WriterProjectionTarget,
} from "@tearleads/validators/response";

/** Citation only saves bytes: a source slower than this sends the read uncited. */
export const MANIFEST_CITATION_DEADLINE_MS = 250;

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
    async () => prepareHeldProjectionCitations(await source.cite(target)),
    signal,
  );
}
