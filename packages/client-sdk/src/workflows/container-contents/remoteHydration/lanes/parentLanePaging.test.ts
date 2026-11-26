import { expect, test } from "bun:test";
import type {
  ContainerParentHydrationLane,
  FetchedContainerParentLanePage,
} from "../types";
import { hasUnusableContinuation, queueNextPage } from "./parentLanePaging";

const FIRST = { id: "row-1", updatedAt: "2026-01-01T00:00:01.000Z" };
const SECOND = { id: "row-2", updatedAt: "2026-01-01T00:00:02.000Z" };

function page(
  lane: ContainerParentHydrationLane,
  response: Partial<FetchedContainerParentLanePage["response"]>,
): FetchedContainerParentLanePage {
  return {
    expectedContainerStates: new Map(),
    expectedHydrationTombstones: new Map(),
    lane,
    response: {
      hasMore: false,
      items: [],
      nextWatermark: null,
      tombstones: [],
      ...response,
    },
    syncLane: { kind: "container_parent", parentId: lane.parentId },
  };
}

function continuationOf(
  fetched: FetchedContainerParentLanePage,
  skipWatermarkWrite = false,
): ContainerParentHydrationLane | undefined {
  let queued: ContainerParentHydrationLane | undefined;
  queueNextPage(fetched, skipWatermarkWrite, (lane) => {
    queued = lane;
  });
  return queued;
}

test("a membership-only listing stays membership-only on its next page", () => {
  const queued = continuationOf(
    page(
      {
        membershipOnly: true,
        parentId: null,
        skipWatermarkWrite: true,
        watermark: null,
      },
      { hasMore: true, nextWatermark: FIRST },
    ),
    true,
  );

  // A continuation that lost the mark would owe a listing to every root
  // container it serves and save a cursor for a listing that has none.
  expect(queued?.membershipOnly).toBe(true);
  expect(queued?.skipWatermarkWrite).toBe(true);
  expect(queued?.watermark).toEqual(FIRST);
});

test("a listing from a watermark continues without the membership mark", () => {
  const queued = continuationOf(
    page(
      { parentId: "parent-1", watermark: FIRST },
      { hasMore: true, nextWatermark: SECOND },
    ),
  );

  expect(queued).toEqual({
    continuationCursors: new Set([
      JSON.stringify([FIRST.updatedAt, FIRST.id]),
      JSON.stringify([SECOND.updatedAt, SECOND.id]),
    ]),
    parentId: "parent-1",
    skipWatermarkWrite: false,
    watermark: SECOND,
  });
});

test("a drained lane queues no further page", () => {
  expect(
    continuationOf(
      page({ parentId: null, watermark: FIRST }, { nextWatermark: SECOND }),
    ),
  ).toBeUndefined();
});

test("a continuation that revisits a position is unusable", () => {
  const first = page(
    { parentId: null, watermark: FIRST },
    { hasMore: true, nextWatermark: SECOND },
  );
  const next = continuationOf(first);
  if (!next) throw new Error("Expected a continuation");

  // The server answers the second page with the position it started from.
  expect(
    hasUnusableContinuation(
      page(next, { hasMore: true, nextWatermark: FIRST }),
    ),
  ).toBe(true);
  expect(hasUnusableContinuation(first)).toBe(false);
});
