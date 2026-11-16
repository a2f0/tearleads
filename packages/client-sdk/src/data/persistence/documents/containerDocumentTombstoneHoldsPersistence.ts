export {
  type ContainerDocumentPlacementKey,
  containerDocumentPlacementKey,
  deleteContainerDocumentTombstoneHoldRowsForLinks,
  deleteContainerDocumentTombstoneHoldsForContainers,
  deleteContainerDocumentTombstoneHoldsForDocuments,
  type HeldContainerDocumentTombstone,
  placementPairsMatch,
} from "./internal/containerDocumentTombstoneHolds";

/**
 * Retry backoff for a held tombstone: fifteen minutes after the first failed
 * verification, doubling on every further failure up to 32 hours. An
 * honest hold that can never verify (the requester lost read access to the
 * document, or it was purged elsewhere) would otherwise cost a head fetch on
 * every discovery of its container for as long as the container exists.
 */
export const HELD_TOMBSTONE_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const HELD_TOMBSTONE_MAX_BACKOFF_DOUBLINGS = 7;

export function heldTombstoneRetryDelayMs(attempts: number): number {
  const doublings = Math.min(
    Math.max(attempts, 1) - 1,
    HELD_TOMBSTONE_MAX_BACKOFF_DOUBLINGS,
  );
  return HELD_TOMBSTONE_RETRY_INTERVAL_MS * 2 ** doublings;
}
