import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@symcrypt/validators/response";
import { DocumentUpdateReadError } from "../../../documents/documentUpdateStore";
import {
  assertSyncPullResponseFits,
  createSyncPullPageResponse,
  resolveSyncPullPagePlan,
} from "./syncPullPagination";

const AFTER_UPDATE_ID = "11111111-1111-4111-8111-111111111111";
const UPPER_BOUND_UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const LATER_UPDATE_ID = "33333333-3333-4333-8333-333333333333";
const CURSOR_HMAC_KEY = "symcrypt-test-document-sync-cursor-hmac-key";
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

test("pull cursor retains the first page upper bound", async () => {
  const firstPlan = await resolveSyncPullPagePlan({
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request(),
    resolveCursorBounds,
    upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
  });
  expect(firstPlan).toEqual({
    afterSequence: 0,
    upperBoundSequence: 42,
    upperBoundUpdateId: UPPER_BOUND_UPDATE_ID,
  });
  if (!firstPlan) throw new Error("Expected a paginated pull plan");

  const firstPage = createSyncPullPageResponse({
    cursorHmacKey: CURSOR_HMAC_KEY,
    hasMore: true,
    identity: IDENTITY,
    lastUpdateId: AFTER_UPDATE_ID,
    plan: firstPlan,
  });
  expect(
    await resolveSyncPullPagePlan({
      cursorHmacKey: CURSOR_HMAC_KEY,
      identity: IDENTITY,
      request: request({ pullCursor: firstPage.nextCursor ?? undefined }),
      resolveCursorBounds,
      upperBound: { id: crypto.randomUUID(), sequence: 99 },
    }),
  ).toEqual({
    afterSequence: 12,
    upperBoundSequence: 42,
    upperBoundUpdateId: UPPER_BOUND_UPDATE_ID,
  });
});

test("pull cursor fails stale when key state rotates", async () => {
  const plan = await resolveSyncPullPagePlan({
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request(),
    resolveCursorBounds,
    upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
  });
  if (!plan) throw new Error("Expected a paginated pull plan");
  const page = createSyncPullPageResponse({
    cursorHmacKey: CURSOR_HMAC_KEY,
    hasMore: true,
    identity: IDENTITY,
    lastUpdateId: AFTER_UPDATE_ID,
    plan,
  });

  await expect(
    resolveSyncPullPagePlan({
      cursorHmacKey: CURSOR_HMAC_KEY,
      identity: { ...IDENTITY, contentKeyEpoch: 4 },
      request: request({ pullCursor: page.nextCursor ?? undefined }),
      resolveCursorBounds,
      upperBound: { id: crypto.randomUUID(), sequence: 99 },
    }),
  ).rejects.toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    status: 409,
  });
});

test("pull cursor rejects malformed requests", async () => {
  await expect(
    resolveSyncPullPagePlan({
      cursorHmacKey: CURSOR_HMAC_KEY,
      identity: IDENTITY,
      request: request({ pullCursor: "not-a-cursor" }),
      resolveCursorBounds,
      upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
    }),
  ).rejects.toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    status: 409,
  });
});

test("pull cursor accepts stale-bundle reads pinned to the same bundle", async () => {
  expect(
    await resolveSyncPullPagePlan({
      cursorHmacKey: CURSOR_HMAC_KEY,
      identity: IDENTITY,
      request: request(),
      resolveCursorBounds,
      upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
    }),
  ).toEqual({
    afterSequence: 0,
    upperBoundSequence: 42,
    upperBoundUpdateId: UPPER_BOUND_UPDATE_ID,
  });
});

test("final pull page has no continuation or storage sequence", () => {
  expect(
    createSyncPullPageResponse({
      cursorHmacKey: CURSOR_HMAC_KEY,
      hasMore: false,
      identity: IDENTITY,
      lastUpdateId: UPPER_BOUND_UPDATE_ID,
      plan: {
        afterSequence: 12,
        upperBoundSequence: 42,
        upperBoundUpdateId: UPPER_BOUND_UPDATE_ID,
      },
    }),
  ).toEqual({ hasMore: false, nextCursor: null });
});

test("pull response rejects an oversized serialized envelope", () => {
  expect(() =>
    assertSyncPullResponseFits({ oversized: "response" }, 8),
  ).toThrow("Document sync response exceeds the pull page byte ceiling");
});

test("pull cursor rejects a tampered frozen upper bound", async () => {
  const plan = await resolveSyncPullPagePlan({
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request(),
    resolveCursorBounds,
    upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
  });
  if (!plan) throw new Error("Expected a paginated pull plan");
  const page = createSyncPullPageResponse({
    cursorHmacKey: CURSOR_HMAC_KEY,
    hasMore: true,
    identity: IDENTITY,
    lastUpdateId: AFTER_UPDATE_ID,
    plan,
  });
  if (!page.nextCursor) throw new Error("Expected a pull continuation");
  const wire = JSON.parse(
    Buffer.from(page.nextCursor, "base64url").toString("utf8"),
  ) as unknown[];
  wire[6] = LATER_UPDATE_ID;
  const tamperedCursor = Buffer.from(JSON.stringify(wire), "utf8").toString(
    "base64url",
  );

  await expect(
    resolveSyncPullPagePlan({
      cursorHmacKey: CURSOR_HMAC_KEY,
      identity: IDENTITY,
      request: request({ pullCursor: tamperedCursor }),
      resolveCursorBounds,
      upperBound: { id: LATER_UPDATE_ID, sequence: 99 },
    }),
  ).rejects.toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    status: 409,
  });
});

test("pull cursor restarts stale when its stored bounds disappear", async () => {
  const plan = await resolveSyncPullPagePlan({
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request(),
    resolveCursorBounds,
    upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
  });
  if (!plan) throw new Error("Expected a paginated pull plan");
  const page = createSyncPullPageResponse({
    cursorHmacKey: CURSOR_HMAC_KEY,
    hasMore: true,
    identity: IDENTITY,
    lastUpdateId: AFTER_UPDATE_ID,
    plan,
  });

  await expect(
    resolveSyncPullPagePlan({
      cursorHmacKey: CURSOR_HMAC_KEY,
      identity: IDENTITY,
      request: request({ pullCursor: page.nextCursor ?? undefined }),
      resolveCursorBounds: async () => {
        throw new DocumentUpdateReadError(
          "Document pull cursor is invalid",
          400,
        );
      },
      upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
    }),
  ).rejects.toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    status: 409,
  });
});

test("pull cursor restarts stale after the deployment key rotates", async () => {
  const plan = await resolveSyncPullPagePlan({
    cursorHmacKey: CURSOR_HMAC_KEY,
    identity: IDENTITY,
    request: request(),
    resolveCursorBounds,
    upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
  });
  if (!plan) throw new Error("Expected a paginated pull plan");
  const page = createSyncPullPageResponse({
    cursorHmacKey: CURSOR_HMAC_KEY,
    hasMore: true,
    identity: IDENTITY,
    lastUpdateId: AFTER_UPDATE_ID,
    plan,
  });

  await expect(
    resolveSyncPullPagePlan({
      cursorHmacKey: "symcrypt-rotated-document-sync-cursor-key",
      identity: IDENTITY,
      request: request({ pullCursor: page.nextCursor ?? undefined }),
      resolveCursorBounds,
      upperBound: { id: UPPER_BOUND_UPDATE_ID, sequence: 42 },
    }),
  ).rejects.toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    status: 409,
  });
});
