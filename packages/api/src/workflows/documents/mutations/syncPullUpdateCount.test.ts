import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  createSyncPullPageResponse,
  resolveSyncPullPagePlan,
} from "./syncPullPagination";

const AFTER_UPDATE_ID = "11111111-1111-4111-8111-111111111111";
const UPPER_BOUND_UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const LATER_UPDATE_ID = "33333333-3333-4333-8333-333333333333";
const CURSOR_HMAC_KEY = "tearleads-test-document-sync-cursor-hmac-key";
const IDENTITY = {
  contentKeyEpoch: 3,
  documentId: "document-1",
  linkSetManifestHash: "manifest-3",
  targetHash: "targets-3",
};

function request(
  overrides: Partial<DocumentSyncRequest> = {},
): DocumentSyncRequest {
  return {
    contentKeyEpoch: 3,
    expectedLinkSetManifestHash: "manifest-3",
    expectedTargetHash: "targets-3",
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
    ...overrides,
  };
}

const resolveCursorBounds = async () => ({
  afterSequence: 12,
  upperBoundSequence: 42,
});

test("every page counts the updates through the pull's frozen bound", async () => {
  const counted: number[] = [];
  const countThrough = async (sequence: number) => {
    counted.push(sequence);
    return sequence / 2;
  };
  const empty = await resolveSyncPullPagePlan({
    countUpdatesThrough: countThrough,
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request(),
    resolveCursorBounds,
    upperBound: null,
  });
  // An empty document has no bound and counts nothing.
  expect(empty?.upperBoundUpdateCount).toBe(0);
  expect(counted).toEqual([]);
  const first = await resolveSyncPullPagePlan({
    countUpdatesThrough: countThrough,
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request(),
    resolveCursorBounds,
    upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
  });
  if (!first) throw new Error("Expected a paginated pull plan");
  const page = createSyncPullPageResponse({
    cursorHmacKey: CURSOR_HMAC_KEY,
    hasMore: true,
    identity: IDENTITY,
    lastUpdateId: AFTER_UPDATE_ID,
    plan: first,
  });
  // A later commit moves the live bound; the continuation keeps the first.
  const next = await resolveSyncPullPagePlan({
    countUpdatesThrough: countThrough,
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request({ pullCursor: page.nextCursor ?? undefined }),
    resolveCursorBounds,
    upperBound: { id: LATER_UPDATE_ID, sequence: 99 },
  });
  expect(counted).toEqual([42, 42]);
  expect(page.throughUpdateCount).toBe(21);
  expect(next?.upperBoundUpdateCount).toBe(21);
});
