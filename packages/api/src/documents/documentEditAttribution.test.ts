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
    updateId: `u-${overrides.sequence}`,
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
      updateId: "u-1",
      updateSequence: 1,
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
      updateId: "u-1",
      updateSequence: 1,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
    {
      peerId: "1",
      startCounter: 3,
      endCounter: 10,
      updateId: "u-9",
      updateSequence: 9,
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
      updateId: "u-2",
      updateSequence: 2,
      writerUserId: "carol",
      writerKeyFingerprint: "fp-carol",
      authorityKind: "direct",
    },
  ]);
});

test("keeps a separate segment per upload, even contiguous same-writer ranges", () => {
  // alice edits peer-1 in two distinct uploads (seq 1 then seq 2); their ranges
  // are contiguous and by the same writer, but each must stay its own segment so
  // the per-upload drill-down can attribute every range to its signed batch.
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
      endCounter: 2,
      updateId: "u-1",
      updateSequence: 1,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
    {
      peerId: "1",
      startCounter: 2,
      endCounter: 4,
      updateId: "u-2",
      updateSequence: 2,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
    {
      peerId: "1",
      startCounter: 4,
      endCounter: 6,
      updateId: "u-3",
      updateSequence: 3,
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
      updateId: "u-3",
      updateSequence: 3,
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
      authorityKind: "baseline",
    },
  ]);
});

test("later overlap boundaries do not fragment an earlier winning upload", () => {
  const segments = resolveEditAttribution([
    span({
      peerId: "1",
      startCounter: 0,
      endCounter: 10,
      sequence: 1,
      writerUserId: "alice",
    }),
    span({
      peerId: "1",
      startCounter: 2,
      endCounter: 3,
      sequence: 2,
      writerUserId: "bob",
    }),
    span({
      peerId: "1",
      startCounter: 6,
      endCounter: 8,
      sequence: 3,
      writerUserId: "carol",
    }),
  ]);

  expect(segments).toEqual([
    {
      peerId: "1",
      startCounter: 0,
      endCounter: 10,
      updateId: "u-1",
      updateSequence: 1,
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
  ]);
});

test("one later upload keeps separate remainders around earlier winners", () => {
  const segments = resolveEditAttribution([
    span({
      peerId: "1",
      startCounter: 2,
      endCounter: 5,
      sequence: 1,
      writerUserId: "alice",
    }),
    span({
      peerId: "1",
      startCounter: 4,
      endCounter: 9,
      sequence: 2,
      writerUserId: "bob",
    }),
    span({
      peerId: "1",
      startCounter: 0,
      endCounter: 12,
      sequence: 3,
      writerUserId: "carol",
    }),
  ]);

  expect(
    segments.map(({ startCounter, endCounter, writerUserId }) => ({
      startCounter,
      endCounter,
      writerUserId,
    })),
  ).toEqual([
    { startCounter: 0, endCounter: 2, writerUserId: "carol" },
    { startCounter: 2, endCounter: 5, writerUserId: "alice" },
    { startCounter: 5, endCounter: 9, writerUserId: "bob" },
    { startCounter: 9, endCounter: 12, writerUserId: "carol" },
  ]);
});

test("resolves a large same-peer history without changing upload granularity", () => {
  const spanCount = 50_000;
  const spans = Array.from({ length: spanCount }, (_, index) =>
    span({
      peerId: "persistent-device-peer",
      startCounter: index * 2,
      endCounter: index * 2 + 1,
      sequence: index + 1,
      writerUserId: "alice",
    }),
  );

  const segments = resolveEditAttribution(spans);

  expect(segments).toHaveLength(spanCount);
  expect(segments[0]).toMatchObject({
    startCounter: 0,
    endCounter: 1,
    updateId: "u-1",
  });
  expect(segments.at(-1)).toMatchObject({
    startCounter: (spanCount - 1) * 2,
    endCounter: (spanCount - 1) * 2 + 1,
    updateId: `u-${spanCount}`,
  });
});
