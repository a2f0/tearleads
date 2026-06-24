import { expect, test } from "bun:test";
import {
  type AttributionSpanInput,
  resolveEditAttribution,
} from "./documentEditAttribution";

function span(
  overrides: Partial<AttributionSpanInput> &
    Pick<
      AttributionSpanInput,
      "peerId" | "startCounter" | "endCounter" | "sequence" | "writerUserId"
    >,
): AttributionSpanInput {
  return {
    writerKeyFingerprint: `fp-${overrides.writerUserId}`,
    isBaseline: false,
    ...overrides,
  };
}

test("attributes a single span to its writer", () => {
  const segments = resolveEditAttribution([
    span({
      peerId: "1",
      startCounter: 0,
      endCounter: 5,
      sequence: 1,
      writerUserId: "alice",
    }),
  ]);
  expect(segments).toEqual([
    {
      peerId: "1",
      startCounter: 0,
      endCounter: 5,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
  ]);
});

test("the earliest-received span wins where two updates cover the same op", () => {
  // alice's narrow update (seq 1) delivered peer-1 ops [0,3); a later baseline
  // (seq 9) re-asserts [0,10). The original 3 ops must stay attributed to alice;
  // only the genuinely-new [3,10) is credited to the baseline author.
  const segments = resolveEditAttribution([
    span({
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      sequence: 1,
      writerUserId: "alice",
    }),
    span({
      peerId: "1",
      startCounter: 0,
      endCounter: 10,
      sequence: 9,
      writerUserId: "bob",
      isBaseline: true,
    }),
  ]);
  expect(segments).toEqual([
    {
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
    {
      peerId: "1",
      startCounter: 3,
      endCounter: 10,
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
      authorityKind: "baseline",
    },
  ]);
});

test("mis-attribution guard: a re-asserting batch never overrides the original author", () => {
  // bob re-asserts peer-2's ops [0,4) in his seq-5 batch, but peer-2's own
  // earlier narrow update (seq 2) already delivered them. Blame stays with the
  // original author, not the re-asserter — even though bob's batch is genuinely
  // signed and covers the range.
  const segments = resolveEditAttribution([
    span({
      peerId: "2",
      startCounter: 0,
      endCounter: 4,
      sequence: 5,
      writerUserId: "bob",
    }),
    span({
      peerId: "2",
      startCounter: 0,
      endCounter: 4,
      sequence: 2,
      writerUserId: "carol",
    }),
  ]);
  expect(segments).toEqual([
    {
      peerId: "2",
      startCounter: 0,
      endCounter: 4,
      writerUserId: "carol",
      writerKeyFingerprint: "fp-carol",
      authorityKind: "direct",
    },
  ]);
});

test("coalesces contiguous same-writer segments and splits on writer change", () => {
  const segments = resolveEditAttribution([
    span({
      peerId: "1",
      startCounter: 0,
      endCounter: 2,
      sequence: 1,
      writerUserId: "alice",
    }),
    span({
      peerId: "1",
      startCounter: 2,
      endCounter: 4,
      sequence: 2,
      writerUserId: "alice",
    }),
    span({
      peerId: "1",
      startCounter: 4,
      endCounter: 6,
      sequence: 3,
      writerUserId: "bob",
    }),
  ]);
  expect(segments).toEqual([
    {
      peerId: "1",
      startCounter: 0,
      endCounter: 4,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
    {
      peerId: "1",
      startCounter: 4,
      endCounter: 6,
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
      authorityKind: "direct",
    },
  ]);
});

test("attributes across multiple peers and sorts the output", () => {
  const segments = resolveEditAttribution([
    span({
      peerId: "20",
      startCounter: 0,
      endCounter: 3,
      sequence: 4,
      writerUserId: "bob",
    }),
    span({
      peerId: "10",
      startCounter: 0,
      endCounter: 2,
      sequence: 1,
      writerUserId: "alice",
    }),
  ]);
  expect(segments.map((segment) => segment.peerId)).toEqual(["10", "20"]);
});

test("drops empty (zero-width) spans", () => {
  expect(
    resolveEditAttribution([
      span({
        peerId: "1",
        startCounter: 5,
        endCounter: 5,
        sequence: 1,
        writerUserId: "alice",
      }),
    ]),
  ).toEqual([]);
});

test("a baseline that introduces a peer the server never saw narrowly is marked baseline", () => {
  const segments = resolveEditAttribution([
    span({
      peerId: "7",
      startCounter: 0,
      endCounter: 8,
      sequence: 3,
      writerUserId: "bob",
      isBaseline: true,
    }),
  ]);
  expect(segments).toEqual([
    {
      peerId: "7",
      startCounter: 0,
      endCounter: 8,
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
      authorityKind: "baseline",
    },
  ]);
});
