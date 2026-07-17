import { expect, test } from "bun:test";
import {
  createRowWriterResolver,
  selectAttributionSegments,
  shouldFetchAttribution,
} from "./useDocumentRowWriters";

function segment(
  peerId: string,
  writerUserId: string,
  writerKeyFingerprint: string,
) {
  return {
    peerId,
    startCounter: 0,
    endCounter: 5,
    writerUserId,
    writerKeyFingerprint,
    authorityKind: "direct" as const,
  };
}

test("selectAttributionSegments uses a complete response's segments", () => {
  const segments = [segment("7", "user-alice", "fp-alice")];
  expect(
    selectAttributionSegments({
      attributionRevision: 1,
      documentId: "doc-1",
      segments,
    }),
  ).toBe(segments);
});

test("selectAttributionSegments drops a truncated response", () => {
  // A truncated list can drop a peer's conflicting segment and mis-resolve it,
  // so it must not be trusted.
  expect(
    selectAttributionSegments({
      attributionRevision: 1,
      documentId: "doc-1",
      segments: [segment("7", "user-alice", "fp-alice")],
      truncated: true,
    }),
  ).toEqual([]);
});

test("selectAttributionSegments treats a null response as no segments", () => {
  expect(selectAttributionSegments(null)).toEqual([]);
});

test("shouldFetchAttribution requires enabled, a synced doc, auth, and online", () => {
  const base = {
    documentId: "doc-1",
    enabled: true,
    isAuthenticated: true,
    online: true,
  };
  expect(shouldFetchAttribution(base)).toBe(true);
  expect(shouldFetchAttribution({ ...base, enabled: false })).toBe(false);
  expect(shouldFetchAttribution({ ...base, documentId: null })).toBe(false);
  expect(shouldFetchAttribution({ ...base, isAuthenticated: false })).toBe(
    false,
  );
  expect(shouldFetchAttribution({ ...base, online: false })).toBe(false);
});

test("resolves a peer to its server-verified writer", () => {
  const resolve = createRowWriterResolver([
    segment("7", "user-alice", "fp-alice"),
  ]);

  expect(resolve("7")).toBe("user-alice");
});

test("returns null for a peer absent from the segments", () => {
  const resolve = createRowWriterResolver([
    segment("7", "user-alice", "fp-alice"),
  ]);

  expect(resolve("9")).toBeNull();
});

test("returns null for a null peer", () => {
  const resolve = createRowWriterResolver([
    segment("7", "user-alice", "fp-alice"),
  ]);

  expect(resolve(null)).toBeNull();
});

test("returns null for a peer spanning conflicting signing identities", () => {
  const resolve = createRowWriterResolver([
    {
      ...segment("7", "user-alice", "fp-alice"),
      startCounter: 0,
      endCounter: 5,
    },
    { ...segment("7", "user-bob", "fp-bob"), startCounter: 5, endCounter: 9 },
  ]);

  expect(resolve("7")).toBeNull();
});
