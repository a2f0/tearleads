/**
 * Convergence-safety helpers for the container-contents metadata sync lane.
 *
 * `syncSingleContainerMetadata` reads `forceReadSync` for a container, then
 * awaits a network GET of the container's metadata document. A remote
 * rename/move event delivered during that await re-queues the container's
 * metadata id and advances that id's entry in `metadataSyncSignalSeqById`. If
 * the pass then deleted the id unconditionally it would erase that fresh
 * re-queue, leaving the structural projection (name/icon) stale until an
 * unrelated later event re-armed it.
 *
 * The pass therefore snapshots the id's sequence before its GET and only clears
 * the queued id when that id's sequence is unchanged at pass end. The sequence
 * is tracked per metadata document id (not a single global counter) so a remote
 * event for an unrelated container does not block clearing this one. Mirrors
 * the document store's `canClearRemoteUpdateSignalAfterSync` (the document store
 * is single-document, so it needs only one counter).
 */

/** Read an id's current enqueue sequence, defaulting to 0 when never queued. */
export function readMetadataSyncSeq(
  seqById: ReadonlyMap<string, number>,
  id: string,
): number {
  return seqById.get(id) ?? 0;
}

/** Advance an id's enqueue sequence (called when a remote event re-queues it). */
export function bumpMetadataSyncSeq(
  seqById: Map<string, number>,
  id: string,
): void {
  seqById.set(id, readMetadataSyncSeq(seqById, id) + 1);
}

function canClearMetadataSyncQueueAfterSync(
  currentSignalSeq: number,
  consumedSignalSeq: number,
): boolean {
  return currentSignalSeq === consumedSignalSeq;
}

/**
 * Delete `id` from the needs-sync queue only if no remote event re-queued that
 * specific id since `consumedSeqById` was snapshotted at pass entry.
 */
export function clearMetadataSyncQueueIfUnchanged(input: {
  needingSync: Set<string>;
  seqById: ReadonlyMap<string, number>;
  consumedSeqById: ReadonlyMap<string, number>;
  id: string;
}): void {
  if (
    canClearMetadataSyncQueueAfterSync(
      readMetadataSyncSeq(input.seqById, input.id),
      input.consumedSeqById.get(input.id) ?? 0,
    )
  ) {
    input.needingSync.delete(input.id);
  }
}
