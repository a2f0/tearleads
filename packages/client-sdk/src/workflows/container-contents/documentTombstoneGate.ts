import type { DocumentSummary } from "../../data/documents/documentSummary";
import type {
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

function placementKey(
  placement: Pick<ContainerDocumentTombstone, "containerId" | "documentId">,
): string {
  return `${placement.documentId}\u0000${placement.containerId}`;
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
    if (!current || current.updatedAt.localeCompare(tombstone.updatedAt) < 0) {
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
 * in the link rows but hidden from container views) and retried on the next
 * discovery of the container, together with the holds it already carries.
 *
 * An honest server only tombstones containers the signed head no longer
 * links, so this refuses no honest data; a dishonest listing can at most hide
 * a placement it could also have withheld, never re-home the document.
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

  const summaries =
    verified.length > 0
      ? await store.applyContainerDocumentTombstones(verified)
      : [];
  if (refuted.length > 0) {
    await store.releaseContainerDocumentTombstoneHolds(refuted);
  }
  if (unverified.length > 0) {
    await store.holdContainerDocumentTombstones(unverified);
  }
  return summaries;
}
