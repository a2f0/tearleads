import { expect, test } from "bun:test";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  CONTAINER_UNAVAILABLE_ERROR_CODE,
} from "@tearleads/validators/response";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";

// #2278 #4: a coded `container_unavailable` 409 is the server's proof that a
// cited container was deleted between the projection fetch and the commit.
// The cited container may be a stale ancestor in the cached destination path,
// so the pass evicts the destination and document projections and retries
// once with fresh paths. When that retry is refused with the same proof the
// intent parks terminally as `unavailable`: unlike a local `blocked` verdict
// it leaves the replay set, so later passes issue no remote requests against
// the deleted container. Only the local tombstone cascade (retarget) or a
// fresh enqueue revives it.
test("a link refused for a deleted destination parks the move after one refreshed retry", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: {
      code: CONTAINER_UNAVAILABLE_ERROR_CODE,
      message: "targetContainerPathRefs[1] container unavailable",
      status: 409,
    },
    passes: 2,
    testDbName: "containerContents-document-move-destination-unavailable",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move cites a container deleted on the server: targetContainerPathRefs[1] container unavailable (409)",
      syncStatus: "unavailable",
    },
  ]);
  // Pass 1: refused, refreshed (evict + probe), refused again — bounded.
  expect(fixture.passes[0]?.cacheEvictions).toEqual([
    `container:${fixture.trashContainerId}`,
    `document:${fixture.documentId}`,
    `container:${fixture.rootContainerId}`,
  ]);
  expect(
    fixture.passes[0]?.remoteRequests.filter((request) => request === "link"),
  ).toHaveLength(2);
  // Pass 2 skipped the parked intent entirely: no preflight, no remote call.
  expect(fixture.passes[1]).toEqual({
    cacheEvictions: [],
    remoteRequests: [],
    submittedOperations: [],
    syncedCount: 0,
  });
  expect(fixture.pendingIntents).toEqual([]);
});

// The refresh is what makes the verdict safe: when the deleted container was
// only a stale ANCESTOR in the cached destination path (the destination had
// been moved under a live parent before its former parent was deleted), the
// destination still resolves after eviction and the retried link with the
// fresh path completes the move in the same pass — nothing parks.
test("a stale ancestor path refreshes the destination and completes the move", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: {
      code: CONTAINER_UNAVAILABLE_ERROR_CODE,
      message: "targetContainerPathRefs[0] container unavailable",
      status: 409,
    },
    linkFailureTimes: 1,
    passes: 2,
    testDbName: "containerContents-document-move-stale-ancestor",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(1);
  expect(fixture.passes[0]?.syncedCount).toBe(1);
  expect(fixture.passes[0]?.cacheEvictions).toEqual([
    `container:${fixture.trashContainerId}`,
    `document:${fixture.documentId}`,
    `container:${fixture.rootContainerId}`,
  ]);
  // The failed link, the refreshed probe, then the accepted link and unlink.
  expect(
    fixture.passes[0]?.remoteRequests.filter((request) => request === "link"),
  ).toHaveLength(2);
  expect(fixture.passes[0]?.submittedOperations).toEqual([
    "preflight",
    "preflight",
    "link",
    "unlink",
  ]);
  expect(fixture.linkedContainerIds).toEqual([fixture.trashContainerId]);
  expect(fixture.intentRows).toEqual([]);
  expect(fixture.passes[1]?.remoteRequests).toEqual([]);
});

// An uncoded 409 proves nothing permanent (a stale head, a lock race) and
// keeps its retriable verdict.
test("an uncoded 409 on a link stays a retriable rejection", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: {
      message: "targetContainerPathRefs[1] is stale",
      status: 409,
    },
    testDbName: "containerContents-document-move-uncoded-conflict",
    unlinkAvailable: true,
  });

  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move was rejected or unavailable: targetContainerPathRefs[1] is stale (409)",
      syncStatus: "pending",
    },
  ]);
});

// The pre-mutation projection fetch carries the same proof as a coded 404;
// here the refreshed destination probe is itself the 404, so the destination
// is proven gone and the intent parks without a retried mutation.
test("a coded container 404 on the destination projection parks the move without replay", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    containerProjectionFailure: {
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      message: "Container not found",
      status: 404,
    },
    passes: 2,
    testDbName: "containerContents-document-move-destination-not-found",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move cites a container deleted on the server: Container not found (404)",
      syncStatus: "unavailable",
    },
  ]);
  expect(fixture.passes[0]?.remoteRequests).toContain("container-projection");
  expect(fixture.passes[1]?.remoteRequests).toEqual([]);
});

// The unlink half cites the SOURCE containers' paths, so a source moved under
// a live parent before its former ancestor was deleted fails the unlink with
// the same proof. The refresh evicts and re-probes every source the unlink
// can cite, not only the destination, and the retried unlink with the fresh
// source path completes the move — nothing parks.
test("a stale source ancestor path refreshes the sources and completes the move", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    passes: 2,
    testDbName: "containerContents-document-move-stale-source-ancestor",
    unlinkAvailable: true,
    unlinkFailure: {
      code: CONTAINER_UNAVAILABLE_ERROR_CODE,
      message: "targetContainerPathRefs[0] container unavailable",
      status: 409,
    },
    unlinkFailureTimes: 1,
  });

  expect(fixture.syncedCount).toBe(1);
  expect(fixture.passes[0]?.cacheEvictions).toEqual([
    `container:${fixture.trashContainerId}`,
    `document:${fixture.documentId}`,
    `container:${fixture.rootContainerId}`,
  ]);
  // Link accepted, unlink refused (a refused submission is not an accepted
  // operation), refreshed, then the unlink accepted on the retry.
  expect(fixture.passes[0]?.submittedOperations).toEqual([
    "preflight",
    "link",
    "preflight",
    "unlink",
  ]);
  expect(
    fixture.passes[0]?.remoteRequests.filter((request) => request === "unlink"),
  ).toHaveLength(2);
  expect(fixture.linkedContainerIds).toEqual([fixture.trashContainerId]);
  expect(fixture.intentRows).toEqual([]);
  expect(fixture.passes[1]?.remoteRequests).toEqual([]);
});

// Security (#2278 #4): a source's fate is never taken from the server. Here
// the server 404s the source's projection while the verified manifest still
// links it. The unlink must still be attempted — the manifest, not a
// server-asserted "container gone", governs the unlink set — and the move
// must not report success while that link remains: it stays partial and
// pending (the destination is fine, so it does not park as unavailable).
test("a server-asserted source 404 never skips the unlink or completes the move", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    containerProjectionFailure: {
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      message: "Container not found",
      status: 404,
    },
    containerProjectionFailureFor: "root",
    passes: 1,
    testDbName: "containerContents-document-move-source-404-asserted",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  // The refresh evicted the source but did not judge it: both attempts
  // tried the unlink (each fetching the source projection and failing).
  expect(fixture.passes[0]?.cacheEvictions).toEqual([
    `container:${fixture.trashContainerId}`,
    `document:${fixture.documentId}`,
    `container:${fixture.rootContainerId}`,
  ]);
  expect(fixture.passes[0]?.submittedOperations).toEqual([
    "preflight",
    "link",
    "preflight",
  ]);
  expect(
    fixture.passes[0]?.remoteRequests.filter(
      (request) => request === "container-projection",
    ).length,
  ).toBeGreaterThanOrEqual(3);
  // The link to the "gone" source is still live: not silently dropped.
  expect(fixture.linkedContainerIds).toContain(fixture.rootContainerId);
  expect(fixture.intentRows).toEqual([
    {
      lastError: "Remote document move partially applied; retry required",
      syncStatus: "pending",
    },
  ]);
});

// The unlink set is read off the REMOTE manifest, so a source linked by a peer
// that this device has not hydrated yet is unknown to the local link
// projection. The refresh must still evict that source's cached path — it is
// enumerated from the refetched manifest, unioned with the local links — so the
// retried unlink cites a fresh path and the move completes.
test("a source linked only remotely is refreshed before the retry", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: {
      code: CONTAINER_UNAVAILABLE_ERROR_CODE,
      message: "targetContainerPathRefs[0] container unavailable",
      status: 409,
    },
    linkFailureTimes: 1,
    passes: 2,
    remoteOnlySourceContainer: true,
    testDbName: "containerContents-document-move-remote-only-source",
    unlinkAvailable: true,
  });

  expect(fixture.extraContainerId).not.toBeNull();
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.passes[0]?.cacheEvictions).toEqual([
    `container:${fixture.trashContainerId}`,
    `document:${fixture.documentId}`,
    `container:${fixture.extraContainerId}`,
    `container:${fixture.rootContainerId}`,
  ]);
  // The retry links, then unlinks both the remote-only and the local source.
  expect(fixture.passes[0]?.submittedOperations).toEqual([
    "preflight",
    "preflight",
    "link",
    "unlink",
    "unlink",
  ]);
  expect(fixture.linkedContainerIds).toEqual([fixture.trashContainerId]);
  expect(fixture.intentRows).toEqual([]);
  expect(fixture.passes[1]?.remoteRequests).toEqual([]);
});
