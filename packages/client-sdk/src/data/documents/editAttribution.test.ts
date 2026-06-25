import { expect, test } from "bun:test";
import {
  type DocumentEditAttributionSegment,
  listDocumentAttributionSegments,
  summarizeDocumentContributors,
  writerByPeerId,
} from "./editAttribution";

function segment(
  overrides: Partial<DocumentEditAttributionSegment> &
    Pick<
      DocumentEditAttributionSegment,
      "peerId" | "startCounter" | "endCounter" | "writerUserId"
    >,
): DocumentEditAttributionSegment {
  return {
    updateId: "u-1",
    updateSequence: 1,
    writerKeyFingerprint: `fp-${overrides.writerUserId}`,
    authorityKind: "direct",
    ...overrides,
  };
}

test("summarizeDocumentContributors aggregates op counts per writer, ordered desc", () => {
  const contributors = summarizeDocumentContributors([
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      writerUserId: "alice",
    }),
    segment({
      peerId: "1",
      startCounter: 3,
      endCounter: 5,
      writerUserId: "alice",
    }),
    segment({
      peerId: "2",
      startCounter: 0,
      endCounter: 9,
      writerUserId: "bob",
    }),
  ]);
  expect(contributors).toEqual([
    {
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
      opCount: 9,
      hasDirectAuthority: true,
      hasBaselineAuthority: false,
    },
    {
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      opCount: 5,
      hasDirectAuthority: true,
      hasBaselineAuthority: false,
    },
  ]);
});

test("summarizeDocumentContributors tracks direct vs baseline authority per writer", () => {
  const [contributor] = summarizeDocumentContributors([
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 2,
      writerUserId: "alice",
      authorityKind: "direct",
    }),
    segment({
      peerId: "9",
      startCounter: 0,
      endCounter: 4,
      writerUserId: "alice",
      authorityKind: "baseline",
    }),
  ]);
  expect(contributor?.hasDirectAuthority).toBe(true);
  expect(contributor?.hasBaselineAuthority).toBe(true);
  expect(contributor?.opCount).toBe(6);
});

test("listDocumentAttributionSegments mirrors contributor order, then counter order", () => {
  const segments = listDocumentAttributionSegments([
    segment({
      peerId: "1",
      startCounter: 3,
      endCounter: 5,
      writerUserId: "alice",
    }),
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      writerUserId: "alice",
    }),
    segment({
      peerId: "2",
      startCounter: 0,
      endCounter: 9,
      writerUserId: "bob",
    }),
  ]);
  // bob outweighs alice (9 vs 5), so bob's range leads; within alice the ranges
  // come back in counter order regardless of input order.
  expect(segments).toEqual([
    {
      peerId: "2",
      startCounter: 0,
      endCounter: 9,
      opCount: 9,
      updateId: "u-1",
      updateSequence: 1,
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
      authorityKind: "direct",
    },
    {
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      opCount: 3,
      updateId: "u-1",
      updateSequence: 1,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
    {
      peerId: "1",
      startCounter: 3,
      endCounter: 5,
      opCount: 2,
      updateId: "u-1",
      updateSequence: 1,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
  ]);
});

test("listDocumentAttributionSegments drops empty ranges and keeps authorityKind", () => {
  const segments = listDocumentAttributionSegments([
    segment({
      peerId: "1",
      startCounter: 4,
      endCounter: 4,
      writerUserId: "alice",
    }),
    segment({
      peerId: "9",
      startCounter: 0,
      endCounter: 6,
      writerUserId: "alice",
      authorityKind: "baseline",
    }),
  ]);
  expect(segments).toEqual([
    {
      peerId: "9",
      startCounter: 0,
      endCounter: 6,
      opCount: 6,
      updateId: "u-1",
      updateSequence: 1,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "baseline",
    },
  ]);
});

test("writerByPeerId resolves a single-writer peer", () => {
  const byPeer = writerByPeerId([
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      writerUserId: "alice",
    }),
    segment({
      peerId: "1",
      startCounter: 3,
      endCounter: 6,
      writerUserId: "alice",
    }),
  ]);
  expect(byPeer.get("1")).toEqual({
    writerUserId: "alice",
    writerKeyFingerprint: "fp-alice",
  });
});

test("writerByPeerId marks a peer split across writers as ambiguous (null)", () => {
  // A re-assertion credited part of peer 1 to bob; the peer is no longer a clean
  // single-writer mapping, so char-level blame must fall back to the segments.
  const byPeer = writerByPeerId([
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      writerUserId: "alice",
    }),
    segment({
      peerId: "1",
      startCounter: 3,
      endCounter: 6,
      writerUserId: "bob",
    }),
  ]);
  expect(byPeer.get("1")).toBeNull();
});
