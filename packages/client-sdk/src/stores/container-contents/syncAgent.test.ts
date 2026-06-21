import { expect, test } from "bun:test";
import {
  bumpMetadataSyncSeq,
  clearMetadataSyncQueueIfUnchanged,
  readMetadataSyncSeq,
} from "./metadataSyncSignal";

// These tests guard a stale-projection race in the container-contents metadata
// lane. syncSingleContainerMetadata reads `forceReadSync` for a container, then
// awaits a network GET of the container's metadata document. The fix it guards:
// the post-await delete from `metadataDocumentIdsNeedingSync` used to be
// unconditional, so a remote rename/move event that re-queued the SAME
// container during the await would have its re-queue erased — leaving the
// structural projection (name/icon) stale until an unrelated later event
// happened to re-arm it. The lane now snapshots the container's per-id sequence
// from `metadataSyncSignalSeqById` before the GET and only clears when that
// specific id's sequence is unchanged.

interface SignalState {
  metadataDocumentIdsNeedingSync: Set<string>;
  metadataSyncSignalSeqById: Map<string, number>;
}

function createSignalState(queuedIds: readonly string[]): SignalState {
  return {
    metadataDocumentIdsNeedingSync: new Set(queuedIds),
    metadataSyncSignalSeqById: new Map(),
  };
}

// Mirrors what handleRemoteEvents does for a remote metadata update: queue the
// id and advance ITS per-id sequence (not a global counter).
function simulateRemoteMetadataEvent(
  state: SignalState,
  metadataDocumentIds: readonly string[],
): void {
  for (const id of metadataDocumentIds) {
    state.metadataDocumentIdsNeedingSync.add(id);
    bumpMetadataSyncSeq(state.metadataSyncSignalSeqById, id);
  }
}

// Mirrors the post-await clear in syncSingleContainerMetadata.
function clearIfUnchanged(
  state: SignalState,
  id: string,
  consumedSeq: number,
): void {
  clearMetadataSyncQueueIfUnchanged({
    consumedSeqById: new Map([[id, consumedSeq]]),
    id,
    needingSync: state.metadataDocumentIdsNeedingSync,
    seqById: state.metadataSyncSignalSeqById,
  });
}

test("a metadata event arriving mid-pass keeps the container queued for the re-run", () => {
  const state = createSignalState(["container-metadata-1"]);

  // Pass enters and snapshots THIS id's sequence, sees forceReadSync=true.
  const consumedSeq = readMetadataSyncSeq(
    state.metadataSyncSignalSeqById,
    "container-metadata-1",
  );

  // A remote rename of the SAME container lands during the GET await.
  simulateRemoteMetadataEvent(state, ["container-metadata-1"]);
  expect(state.metadataSyncSignalSeqById.get("container-metadata-1")).toBe(1);

  // The pass must NOT clear the queued id: the rename may post-date its GET
  // snapshot, so the coalesced re-run has to fetch it.
  clearIfUnchanged(state, "container-metadata-1", consumedSeq);
  expect(state.metadataDocumentIdsNeedingSync.has("container-metadata-1")).toBe(
    true,
  );
});

// Regression for the per-id requirement (Gemini review on PR #1039): with a
// single global sequence, a remote event for ANY other container during the
// await would block clearing the container actually being synced, causing
// redundant re-sync passes for already-synced containers. With a per-id
// sequence, an unrelated container's event must not affect this one.
test("an unrelated container's mid-pass event does not block clearing this one", () => {
  const state = createSignalState(["container-metadata-1"]);
  const consumedSeq = readMetadataSyncSeq(
    state.metadataSyncSignalSeqById,
    "container-metadata-1",
  );

  // A remote event for a DIFFERENT container lands during the await.
  simulateRemoteMetadataEvent(state, ["container-metadata-OTHER"]);

  // container-metadata-1's own sequence is unchanged, so it clears normally.
  clearIfUnchanged(state, "container-metadata-1", consumedSeq);
  expect(state.metadataDocumentIdsNeedingSync.has("container-metadata-1")).toBe(
    false,
  );
  // The unrelated container stays queued for its own pass.
  expect(
    state.metadataDocumentIdsNeedingSync.has("container-metadata-OTHER"),
  ).toBe(true);
});

test("a quiescent metadata pass clears the queue so it does not re-sync forever", () => {
  const state = createSignalState(["container-metadata-1"]);
  // Pretend prior events advanced this id to seq 2; the pass consumes seq 2.
  state.metadataSyncSignalSeqById.set("container-metadata-1", 2);
  const consumedSeq = 2;

  // No remote event during the await: the id's sequence is unchanged, so
  // clearing is safe and required to stop the lane from looping.
  clearIfUnchanged(state, "container-metadata-1", consumedSeq);
  expect(state.metadataDocumentIdsNeedingSync.size).toBe(0);
});
