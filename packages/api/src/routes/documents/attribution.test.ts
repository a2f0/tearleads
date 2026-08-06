import { expect, mock, test } from "bun:test";
import { createMiddleware } from "hono/factory";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import {
  createDocumentAttributionEtag,
  createDocumentAttributionRoute,
  ifNoneMatchMatches,
} from "./attribution";

const ATTRIBUTION_SCOPE = "2026-07-14T00:00:00.000Z:access-state-hash-1";
const DOCUMENT_INCARNATION = "2026-07-14T00:00:00.000Z";

function authenticated(userId = "user-1") {
  return createMiddleware<SessionEnv>(async (c, next) => {
    c.set("session", {
      createdAt: Date.now(),
      fingerprint: "test-fingerprint",
      id: "test-session",
      ipAddresses: [],
      lastActiveAt: Date.now(),
      lastActiveIp: null,
      userId,
    });
    return next();
  });
}

test("attribution ETags use weak If-None-Match comparison", () => {
  const etag = createDocumentAttributionEtag(7, ATTRIBUTION_SCOPE);
  expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
  expect(
    ifNoneMatchMatches(
      `"document-attribution-v2-${ATTRIBUTION_SCOPE}-7"`,
      etag,
    ),
  ).toBe(true);
  expect(ifNoneMatchMatches(`"other", ${etag}`, etag)).toBe(true);
  expect(ifNoneMatchMatches("*", etag)).toBe(true);
  expect(
    ifNoneMatchMatches(
      `W/"document-attribution-v2-${ATTRIBUTION_SCOPE}-8"`,
      etag,
    ),
  ).toBe(false);
});

test("default attribution revalidates after authorization without loading spans", async () => {
  const prepareAttribution = mock(
    async (
      _runtime: ApiServiceRuntime,
      _input: { documentId: string; userId: string },
    ) => ({
      attributionScope: ATTRIBUTION_SCOPE,
      attributionRevision: 4,
      documentId: "document-1",
      documentIncarnation: DOCUMENT_INCARNATION,
    }),
  );
  const loadAttribution = mock(
    async (
      _runtime: ApiServiceRuntime,
      _input: {
        attributionScope: string;
        attributionRevision: number;
        documentId: string;
      },
    ) => ({
      attributionRevision: 4,
      json: JSON.stringify({
        attributionRevision: 4,
        documentId: "document-1",
        segments: [],
      }),
    }),
  );
  const app = createDocumentAttributionRoute({
    loadAttribution,
    prepareAttribution,
    requireAuth: authenticated(),
    runtime: createServiceTestRuntime(),
  });

  const response = await app.request("/documents/document-1/attribution", {
    headers: {
      "If-None-Match": createDocumentAttributionEtag(4, ATTRIBUTION_SCOPE),
    },
  });

  expect(response.status).toBe(304);
  expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  expect(response.headers.get("ETag")).toBe(
    createDocumentAttributionEtag(4, ATTRIBUTION_SCOPE),
  );
  expect(prepareAttribution).toHaveBeenCalledTimes(1);
  expect(prepareAttribution.mock.calls[0]?.[1]).toEqual({
    documentId: "document-1",
    userId: "user-1",
  });
  expect(loadAttribution).not.toHaveBeenCalled();
});

test("an unauthorized attribution request cannot receive a cached 304", async () => {
  const prepareAttribution = mock(
    async (
      _runtime: ApiServiceRuntime,
      _input: { documentId: string; userId: string },
    ) => ({
      attributionScope: ATTRIBUTION_SCOPE,
      attributionRevision: 4,
      documentId: "document-1",
      documentIncarnation: DOCUMENT_INCARNATION,
    }),
  );
  const loadAttribution = mock(
    async (
      _runtime: ApiServiceRuntime,
      _input: {
        attributionScope: string;
        attributionRevision: number;
        documentId: string;
      },
    ) => ({
      attributionRevision: 4,
      json: JSON.stringify({
        attributionRevision: 4,
        documentId: "document-1",
        segments: [],
      }),
    }),
  );
  const app = createDocumentAttributionRoute({
    loadAttribution,
    prepareAttribution,
    requireAuth: createMiddleware<SessionEnv>((c) =>
      Promise.resolve(c.json({ error: "Unauthorized" }, 401)),
    ),
    runtime: createServiceTestRuntime(),
  });

  const response = await app.request("/documents/document-1/attribution", {
    headers: {
      "If-None-Match": createDocumentAttributionEtag(4, ATTRIBUTION_SCOPE),
    },
  });

  expect(response.status).toBe(401);
  expect(prepareAttribution).not.toHaveBeenCalled();
  expect(loadAttribution).not.toHaveBeenCalled();
});

test("attribution JSON over 1KB is compressed on the attribution route", async () => {
  const segments = Array.from({ length: 40 }, (_, index) => ({
    authorityKind: "direct" as const,
    endCounter: index + 1,
    peerId: `peer-${index}`,
    startCounter: index,
    writerKeyFingerprint: `fingerprint-${index}`,
    writerUserId: `user-${index}`,
  }));
  const app = createDocumentAttributionRoute({
    loadAttribution: async () => ({
      attributionRevision: 5,
      json: JSON.stringify({
        attributionRevision: 5,
        documentId: "document-1",
        segments,
      }),
    }),
    prepareAttribution: async () => ({
      attributionScope: ATTRIBUTION_SCOPE,
      attributionRevision: 5,
      documentId: "document-1",
      documentIncarnation: DOCUMENT_INCARNATION,
    }),
    requireAuth: authenticated(),
    runtime: createServiceTestRuntime(),
  });

  const response = await app.request("/documents/document-1/attribution", {
    headers: { "Accept-Encoding": "gzip" },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBe("gzip");
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
});

test("the detailed ranges route forwards its opaque cursor and limit", async () => {
  const listAttributionRanges = mock(
    async (
      _runtime: ApiServiceRuntime,
      _input: {
        cursor?: string | undefined;
        documentId: string;
        expectedRevision?: number | undefined;
        limit?: number | undefined;
        userId: string;
      },
    ) => ({
      attributionRevision: 5,
      documentId: "document-1",
      hasMore: false,
      items: [],
      nextCursor: null,
    }),
  );
  const app = createDocumentAttributionRoute({
    listAttributionRanges,
    requireAuth: authenticated(),
    runtime: createServiceTestRuntime(),
  });

  const response = await app.request(
    "/documents/document-1/attribution/ranges?cursor=opaque&expectedRevision=5&limit=25",
  );

  expect(response.status).toBe(200);
  expect(listAttributionRanges.mock.calls[0]?.[1]).toEqual({
    cursor: "opaque",
    documentId: "document-1",
    expectedRevision: 5,
    limit: 25,
    userId: "user-1",
  });
});

test.each([
  ["limit", "not-a-number", "Document attribution range limit is invalid"],
  ["limit", "0", "Document attribution range limit must be between 1 and 500"],
  [
    "expectedRevision",
    "not-a-number",
    "Document attribution expected revision is invalid",
  ],
] as const)("the detailed ranges route rejects an invalid %s", async (parameter, value, message) => {
  const listAttributionRanges = mock(async () => {
    throw new Error("Attribution service should not be called");
  });
  const app = createDocumentAttributionRoute({
    listAttributionRanges,
    requireAuth: authenticated(),
    runtime: createServiceTestRuntime(),
  });

  const response = await app.request(
    `/documents/document-1/attribution/ranges?${parameter}=${value}`,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: message });
  expect(listAttributionRanges).not.toHaveBeenCalled();
});
