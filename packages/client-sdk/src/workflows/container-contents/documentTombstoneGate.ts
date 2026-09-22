import type { DocumentSummary } from "../../data/documents/documentSummary";
import { containerDocumentPlacementKey as placementKey } from "../../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import type {
  ContainerDocumentPlacement,
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  DiscoverContainerDocumentsOptions,
} from "./documentDiscoveryTypes";

type TombstoneGateStore = Pick<
  DiscoverContainerDocumentsOptions,
  | "applyContainerDocumentTombstones"
  | "holdContainerDocumentTombstones"
  | "listHeldContainerDocumentTombstones"
  | "listKnownContainerDocumentPlacements"
  | "releaseContainerDocumentTombstoneHolds"
  | "verifyContainerDocumentTombstones"
>;

function dedupePlacements<T extends ContainerDocumentPlacement>(
  placements: ReadonlyArray<T>,
): T[] {
  const seen = new Set<string>();
  return placements.filter((placement) => {
    const key = placementKey(placement);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One candidate per placement the device actually holds; the newest server
 * timestamp wins. A tombstone for a placement this device never had has
 * nothing to remove or hide, so its head is not fetched.
 */
async function mergeTombstoneCandidates(
  store: TombstoneGateStore,
  listed: ReadonlyArray<ContainerDocumentTombstone>,
  held: ReadonlyArray<ContainerDocumentTombstone>,
): Promise<ContainerDocumentTombstone[]> {
  const known = new Set(
    (await store.listKnownContainerDocumentPlacements(listed)).map(
      placementKey,
    ),
  );
  const byPlacement = new Map<string, ContainerDocumentTombstone>();
  for (const tombstone of [
    ...held,
    ...listed.filter((tombstone) => known.has(placementKey(tombstone))),
  ]) {
    const key = placementKey(tombstone);
    const current = byPlacement.get(key);
    if (
      !current ||
      Date.parse(current.updatedAt) < Date.parse(tombstone.updatedAt)
    ) {
      byPlacement.set(key, tombstone);
    }
  }
  return [...byPlacement.values()];
}

function assertVerdictsCoverCandidates(
  candidates: ReadonlyArray<ContainerDocumentTombstone>,
  verdicts: ReadonlyArray<ContainerDocumentTombstoneVerdict>,
): void {
  const verdictKeys = new Set(
    verdicts.map((verdict) => placementKey(verdict.tombstone)),
  );
  if (
    verdictKeys.size !== verdicts.length ||
    verdictKeys.size !== candidates.length ||
    candidates.some((candidate) => !verdictKeys.has(placementKey(candidate)))
  ) {
    throw new Error(
      "Container document tombstone verification must return one verdict per tombstone",
    );
  }
}

/**
 * A listing tombstone is server-asserted placement removal. It is applied
 * only on signed evidence: the document's verified head link set omits the
 * container (`verified`). A head that still links the container `refuted`s
 * the tombstone, which is dropped and any earlier hold released. Without a
 * verified head the tombstone is `unverified`: the placement is held (kept
 * in the link rows but hidden from container views) and retried, with
 * backoff, on a later discovery of the container.
 *
 * An honest server only tombstones containers the signed head no longer
 * links, so this refuses no honest data. A dishonest listing paired with a
 * withheld head can still hide a placement this device already had, for as
 * long as the head stays withheld; what a tombstone can no longer do is
 * delete the placement or re-home the document. The listing-item path
 * (`replaceDocumentLinksBatch` and the discovered placement) remains
 * unverified and is outside this gate.
 */
export async function settleContainerDocumentTombstones(input: {
  containerIds: ReadonlyArray<string>;
  store: TombstoneGateStore;
  tombstones: ReadonlyArray<ContainerDocumentTombstone>;
}): Promise<ReadonlyArray<DocumentSummary>> {
  const { store } = input;
  const held = await store.listHeldContainerDocumentTombstones(
    input.containerIds,
  );
  const candidates = await mergeTombstoneCandidates(
    store,
    input.tombstones,
    held,
  );
  if (candidates.length === 0) {
    return [];
  }

  const verdicts = await store.verifyContainerDocumentTombstones(candidates);
  assertVerdictsCoverCandidates(candidates, verdicts);
  const verified = verdicts.flatMap((verdict) =>
    verdict.kind === "verified" ? [verdict.tombstone] : [],
  );
  const refuted = verdicts.flatMap((verdict) =>
    verdict.kind === "refuted" ? [verdict.tombstone] : [],
  );
  const unverified = verdicts.flatMap((verdict) =>
    verdict.kind === "unverified" ? [verdict.tombstone] : [],
  );
  const deferred = verdicts.flatMap((verdict) =>
    verdict.kind === "deferred"
      ? [{ ...verdict.tombstone, deferred: true }]
      : [],
  );
  // A loaded head is evidence for every placement it links, including holds
  // on this document that were not due this run: release them now rather
  // than hiding the placement until their own backoff expires.
  const headLinkedPlacements = verdicts.flatMap((verdict) => {
    if (verdict.kind !== "verified" && verdict.kind !== "refuted") return [];
    const linked =
      verdict.kind === "verified"
        ? verdict.tombstone.linkedContainerIds
        : verdict.linkedContainerIds;
    return linked.map((containerId) => ({
      containerId,
      documentId: verdict.tombstone.documentId,
    }));
  });

  const summaries =
    verified.length > 0
      ? await store.applyContainerDocumentTombstones(verified)
      : [];
  const released = dedupePlacements([...refuted, ...headLinkedPlacements]);
  if (released.length > 0) {
    await store.releaseContainerDocumentTombstoneHolds(released);
  }
  if (unverified.length + deferred.length > 0) {
    await store.holdContainerDocumentTombstones([...unverified, ...deferred]);
  }
  return summaries;
}
