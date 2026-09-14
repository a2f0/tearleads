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
