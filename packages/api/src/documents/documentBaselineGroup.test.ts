import { expect, test } from "bun:test";
import { computeDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import {
  type DocumentBaselineGroupFault,
  type DocumentBaselineSegment,
  documentBaselineGroupFaultMessage,
  judgeDocumentBaselineGroup,
} from "./documentBaselineGroup";

const DOCUMENT_ID = "6f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e";
const BASELINE_ID = "0e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6";
const CURSOR = "1e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6";

function vector(counters: Record<string, number>): string {
  return encodeVersionVectorCounters(counters);
}

type Range = Pick<
  DocumentBaselineSegment,
  | "dependencyVersionVector"
  | "partialEndVersionVector"
  | "partialStartVersionVector"
>;

/** Peer 7's first five operations, then peer 9's, which build on them. */
const RANGES: readonly Range[] = [
  {
    dependencyVersionVector: emptyVersionVector(),
    partialEndVersionVector: vector({ "7": 3 }),
    partialStartVersionVector: emptyVersionVector(),
  },
  {
    dependencyVersionVector: vector({ "7": 3 }),
    partialEndVersionVector: vector({ "7": 5, "9": 2 }),
    partialStartVersionVector: vector({ "7": 3 }),
  },
  {
    dependencyVersionVector: vector({ "7": 5, "9": 2 }),
    partialEndVersionVector: vector({ "9": 6 }),
    partialStartVersionVector: vector({ "9": 2 }),
  },
];

/** A whole group over `ranges`, sealed as an honest writer seals it. */
async function group(
  ranges: readonly Range[] = RANGES,
  coversThroughUpdateId?: string,
): Promise<DocumentBaselineSegment[]> {
  const segments: DocumentBaselineSegment[] = ranges.map((range, index) => ({
    ...range,
    baselineId: BASELINE_ID,
    baselineSegmentCount: undefined,
    baselineSegmentIndex: index,
    baselineSegmentsDigest: undefined,
    ciphertextHash: `ciphertext-${index}`,
    coversThroughUpdateId: undefined,
    metadataHash: `metadata-${index}`,
    updateId: `update-${index}`,
  }));
  return seal(segments, coversThroughUpdateId);
}

/** Signs the count, digest and cursor on the last of `segments`. */
async function seal(
  segments: readonly DocumentBaselineSegment[],
  coversThroughUpdateId?: string,
): Promise<DocumentBaselineSegment[]> {
  const final = segments.at(-1);
  if (!final) throw new Error("No segments");
  return [
    ...segments.slice(0, -1),
    {
      ...final,
      baselineSegmentCount: segments.length,
      baselineSegmentsDigest: await computeDocumentBaselineSegmentsDigest({
        baselineId: BASELINE_ID,
        documentId: DOCUMENT_ID,
        segments: segments.slice(0, -1),
      }),
      coversThroughUpdateId,
    },
  ];
}

async function fault(
  segments: readonly DocumentBaselineSegment[],
): Promise<DocumentBaselineGroupFault | null> {
  const verdict = await judgeDocumentBaselineGroup({
    documentId: DOCUMENT_ID,
    segments,
  });
  return verdict.ok ? null : verdict.fault;
}

function at(
  segments: readonly DocumentBaselineSegment[],
  index: number,
): DocumentBaselineSegment {
  const segment = segments[index];
  if (!segment) throw new Error(`No segment ${index}`);
  return segment;
}

test("a whole group covers the version its segments reach and keeps its cursor", async () => {
  const verdict = await judgeDocumentBaselineGroup({
    documentId: DOCUMENT_ID,
    segments: await group(RANGES, CURSOR),
  });
  expect(verdict).toEqual({
    group: {
      baselineId: BASELINE_ID,
      coverage: vector({ "7": 5, "9": 6 }),
      coversThroughUpdateId: CURSOR,
    },
    ok: true,
  });
  // One segment is the small-document case; a database row holds nulls.
  const one = await group([
    {
      dependencyVersionVector: emptyVersionVector(),
      partialEndVersionVector: vector({ "7": 5 }),
      partialStartVersionVector: emptyVersionVector(),
    },
  ]);
  expect(
    await judgeDocumentBaselineGroup({
      documentId: DOCUMENT_ID,
      segments: [{ ...at(one, 0), coversThroughUpdateId: null }],
    }),
  ).toMatchObject({ group: { coversThroughUpdateId: undefined }, ok: true });
});

test("segments out of index order, or with one missing, are refused", async () => {
  const [first, second, third] = await group();
  if (!first || !second || !third) throw new Error("Expected three segments");
  expect(await fault([second, first, third])).toBe("segment_out_of_order");
  expect(await fault([first, third])).toBe("segment_out_of_order");
  expect(await fault([second, third])).toBe("segment_out_of_order");
  // The same segment twice is a repeated index.
  expect(await fault([first, first, second, third])).toBe(
    "segment_out_of_order",
  );
});

test("a group names one baseline", async () => {
  const segments = await group();
  expect(
    await fault([
      at(segments, 0),
      { ...at(segments, 1), baselineId: CURSOR },
      at(segments, 2),
    ]),
  ).toBe("mixed_baseline");
  expect(await fault([{ ...at(segments, 0), baselineId: undefined }])).toBe(
    "not_a_segment",
  );
  expect(
    await fault([at(segments, 0), { ...at(segments, 1), baselineId: null }]),
  ).toBe("not_a_segment");
  expect(await fault([])).toBe("not_a_segment");
});

test("the final segment's count is the number of segments", async () => {
  const segments = await group();
  for (const baselineSegmentCount of [2, 4, undefined, null]) {
    expect(
      await fault([
        at(segments, 0),
        at(segments, 1),
        { ...at(segments, 2), baselineSegmentCount },
      ]),
    ).toBe("segment_count_mismatch");
  }
  // A group cut short keeps its indices but not its seal.
  expect(await fault(segments.slice(0, 2))).toBe("segment_count_mismatch");
});

test("only the final segment seals the group", async () => {
  const segments = await group();
  for (const early of [
    { baselineSegmentCount: 3 },
    { baselineSegmentsDigest: "digest" },
    { coversThroughUpdateId: CURSOR },
  ]) {
    expect(
      await fault([
        at(segments, 0),
        { ...at(segments, 1), ...early },
        at(segments, 2),
      ]),
    ).toBe("sealed_early");
  }
});

test("the final segment's digest binds the segments before it", async () => {
  const segments = await group();
  expect(
    await fault([
      at(segments, 0),
      at(segments, 1),
      { ...at(segments, 2), baselineSegmentsDigest: "0".repeat(64) },
    ]),
  ).toBe("digest_mismatch");
  for (const replaced of [
    { updateId: "update-x" },
    { metadataHash: "metadata-x" },
    { ciphertextHash: "ciphertext-x" },
  ]) {
    expect(
      await fault([
        at(segments, 0),
        { ...at(segments, 1), ...replaced },
        at(segments, 2),
      ]),
    ).toBe("digest_mismatch");
  }
  // The digest of another document's group, or another baseline's.
  const foreign = await computeDocumentBaselineSegmentsDigest({
    baselineId: BASELINE_ID,
    documentId: CURSOR,
    segments: segments.slice(0, -1),
  });
  expect(
    await fault([
      at(segments, 0),
      at(segments, 1),
      { ...at(segments, 2), baselineSegmentsDigest: foreign },
    ]),
  ).toBe("digest_mismatch");
});

test("each peer's spans run gapless from zero", async () => {
  const [first, second, third] = RANGES;
  if (!first || !second || !third) throw new Error("Expected three ranges");
  const gapped: Range[][] = [
    // Peer 7 starts at 1, not zero.
    [{ ...first, partialStartVersionVector: vector({ "7": 1 }) }],
    // Peer 7 skips counter 3.
    [
      first,
      {
        ...second,
        dependencyVersionVector: vector({ "7": 3 }),
        partialStartVersionVector: vector({ "7": 4 }),
      },
      third,
    ],
    // Peer 9's second span overlaps its first.
    [
      first,
      second,
      { ...third, partialStartVersionVector: vector({ "9": 1 }) },
    ],
    // A start past its end is no range at all.
    [{ ...first, partialStartVersionVector: vector({ "7": 9 }) }],
    [{ ...first, partialEndVersionVector: "not-a-vector" }],
  ];
  for (const ranges of gapped) {
    expect(await fault(await group(ranges))).toBe("history_not_gapless");
  }
});

test("a segment depends only on segments before it", async () => {
  const [first, second, third] = RANGES;
  if (!first || !second || !third) throw new Error("Expected three ranges");
  // The first segment depends on peer 9, which the second one brings.
  expect(
    await fault(
      await group([
        { ...first, dependencyVersionVector: vector({ "9": 1 }) },
        second,
        third,
      ]),
    ),
  ).toBe("history_not_gapless");
  // A dependency no segment carries.
  expect(
    await fault(
      await group([
        first,
        { ...second, dependencyVersionVector: vector({ "7": 3, "11": 1 }) },
        third,
      ]),
    ),
  ).toBe("history_not_gapless");
  expect(
    await fault(
      await group([{ ...first, dependencyVersionVector: "not-a-vector" }]),
    ),
  ).toBe("history_not_gapless");
});

// A segment's vectors are claims. What a group covers is what its spans
// carry from zero, so a vector that names a peer at a counter no segment
// reached, with no span of its own, must not count as coverage (#3238).
test("a peer named at a counter the group has not reached is refused", async () => {
  const carried = {
    dependencyVersionVector: emptyVersionVector(),
    partialEndVersionVector: vector({ "7": 5, "8": 4, "9": 6 }),
    partialStartVersionVector: vector({ "8": 4, "9": 6 }),
  };
  // One span, peer 7's, and two peers named at their ends with none.
  expect(await fault(await group([carried]))).toBe("history_not_gapless");
  // The same claim with no span at all, signed as an empty baseline.
  expect(
    await fault(
      await group(
        [
          {
            dependencyVersionVector: emptyVersionVector(),
            partialEndVersionVector: vector({ "7": 10, "8": 3 }),
            partialStartVersionVector: vector({ "7": 10, "8": 3 }),
          },
        ],
        CURSOR,
      ),
    ),
  ).toBe("history_not_gapless");
  // A later segment that names an earlier peer anywhere but where it stands.
  const [first, second, third] = RANGES;
  if (!first || !second || !third) throw new Error("Expected three ranges");
  expect(
    await fault(
      await group([
        first,
        second,
        {
          ...third,
          partialEndVersionVector: vector({ "7": 9, "9": 6 }),
          partialStartVersionVector: vector({ "7": 9, "9": 2 }),
        },
      ]),
    ),
  ).toBe("history_not_gapless");
  // Naming a peer exactly where the group stands claims nothing new.
  const verdict = await judgeDocumentBaselineGroup({
    documentId: DOCUMENT_ID,
    segments: await group([
      first,
      second,
      {
        ...third,
        partialEndVersionVector: vector({ "7": 5, "9": 6 }),
        partialStartVersionVector: vector({ "7": 5, "9": 2 }),
      },
    ]),
  });
  expect(verdict).toMatchObject({
    group: { coverage: vector({ "7": 5, "9": 6 }) },
    ok: true,
  });
});

// "No operations" means no span, however the vectors spell it, here and in
// the append that follows (`assertOutgoingSpanOrEmptyBaseline`).
test("a segment with no span is empty whatever its vectors name", async () => {
  const zeroStart = {
    dependencyVersionVector: emptyVersionVector(),
    partialEndVersionVector: emptyVersionVector(),
    partialStartVersionVector: vector({ "7": 0 }),
  };
  expect(await fault(await group([zeroStart]))).toBe("cursor_missing");
  expect(await fault(await group([zeroStart], CURSOR))).toBeNull();
  const [first] = RANGES;
  if (!first) throw new Error("Expected a range");
  expect(await fault(await group([first, zeroStart], CURSOR))).toBe(
    "history_not_gapless",
  );
});

test("an empty baseline is one segment that signs a cursor", async () => {
  const empty: Range = {
    dependencyVersionVector: emptyVersionVector(),
    partialEndVersionVector: emptyVersionVector(),
    partialStartVersionVector: emptyVersionVector(),
  };
  expect(
    await judgeDocumentBaselineGroup({
      documentId: DOCUMENT_ID,
      segments: await group([empty], CURSOR),
    }),
  ).toEqual({
    group: {
      baselineId: BASELINE_ID,
      coverage: emptyVersionVector(),
      coversThroughUpdateId: CURSOR,
    },
    ok: true,
  });
  expect(await fault(await group([empty]))).toBe("cursor_missing");
  const [first] = RANGES;
  if (!first) throw new Error("Expected a range");
  expect(await fault(await group([first, empty], CURSOR))).toBe(
    "empty_segment",
  );
  expect(
    await fault(
      await group(
        [
          first,
          {
            dependencyVersionVector: vector({ "7": 3 }),
            partialEndVersionVector: vector({ "7": 3 }),
            partialStartVersionVector: vector({ "7": 3 }),
          },
        ],
        CURSOR,
      ),
    ),
  ).toBe("empty_segment");
});

test("every fault has a reason a client can read", () => {
  const faults: DocumentBaselineGroupFault[] = [
    "cursor_missing",
    "digest_mismatch",
    "empty_segment",
    "history_not_gapless",
    "mixed_baseline",
    "not_a_segment",
    "segment_count_mismatch",
    "segment_out_of_order",
    "sealed_early",
  ];
  expect(new Set(faults.map(documentBaselineGroupFaultMessage)).size).toBe(
    faults.length,
  );
});
