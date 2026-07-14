import { expect, test } from "bun:test";
import {
  type DocumentEditAttributionRange,
  listDocumentAttributionSegments,
  resolveOpIdAttribution,
  summarizeBlameRanges,
  summarizeCharacterBlame,
  summarizeDocumentContributors,
  summarizeFieldBlame,
  writerByPeerId,
} from "./editAttribution";

function blameSource(pairs: ReadonlyArray<[string, string, number]>): {
  codePoints: string[];
  opIds: Array<{ peerId: string; counter: number }>;
} {
  return {
    codePoints: pairs.map(([codePoint]) => codePoint),
    opIds: pairs.map(([, peerId, counter]) => ({ peerId, counter })),
  };
}

function segment(
  overrides: Partial<DocumentEditAttributionRange> &
    Pick<
      DocumentEditAttributionRange,
      "peerId" | "startCounter" | "endCounter" | "writerUserId"
    >,
): DocumentEditAttributionRange {
  return {
    updateId: "u-1",
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
      directOpCount: 9,
      baselineOpCount: 0,
      hasDirectAuthority: true,
      hasBaselineAuthority: false,
    },
    {
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      opCount: 5,
      directOpCount: 5,
      baselineOpCount: 0,
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
  expect(contributor?.directOpCount).toBe(2);
  expect(contributor?.baselineOpCount).toBe(4);
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
  expect(segments).toEqual([
    {
      peerId: "2",
      startCounter: 0,
      endCounter: 9,
      opCount: 9,
      updateId: "u-1",
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

test("resolveOpIdAttribution credits the segment covering a split peer's op id", () => {
  const segments = [
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
  ];
  expect(writerByPeerId(segments).get("1")).toBeNull();
  expect(resolveOpIdAttribution(segments, "1", 0)).toEqual({
    writerUserId: "alice",
    writerKeyFingerprint: "fp-alice",
    authorityKind: "direct",
  });
  expect(resolveOpIdAttribution(segments, "1", 4)).toEqual({
    writerUserId: "bob",
    writerKeyFingerprint: "fp-bob",
    authorityKind: "direct",
  });
});

test("resolveOpIdAttribution treats ranges as half-open and carries authorityKind", () => {
  const segments = [
    segment({
      peerId: "9",
      startCounter: 2,
      endCounter: 5,
      writerUserId: "carol",
      authorityKind: "baseline",
    }),
  ];
  expect(resolveOpIdAttribution(segments, "9", 2)?.authorityKind).toBe(
    "baseline",
  );
  expect(resolveOpIdAttribution(segments, "9", 4)?.writerUserId).toBe("carol");
  expect(resolveOpIdAttribution(segments, "9", 5)).toBeNull();
});

test("resolveOpIdAttribution returns null for an op id no segment covers", () => {
  const segments = [
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
      writerUserId: "alice",
    }),
  ];
  expect(resolveOpIdAttribution(segments, "1", 9)).toBeNull(); // counter past the range
  expect(resolveOpIdAttribution(segments, "2", 0)).toBeNull(); // peer not attributed
  expect(resolveOpIdAttribution([], "1", 0)).toBeNull(); // no segments at all
});

test("summarizeCharacterBlame counts live characters per writer with totals", () => {
  const segments = [
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
    segment({
      peerId: "2",
      startCounter: 0,
      endCounter: 4,
      writerUserId: "carol",
      authorityKind: "baseline",
    }),
  ];
  const summary = summarizeCharacterBlame(
    [
      { peerId: "1", counter: 0 }, // alice
      { peerId: "1", counter: 1 }, // alice
      { peerId: "2", counter: 0 }, // carol (baseline)
      { peerId: "1", counter: 5 }, // bob
      { peerId: "9", counter: 0 }, // no segment covers peer 9 -> unattributed
    ],
    segments,
  );
  expect(summary).toEqual({
    writers: [
      {
        writerUserId: "alice",
        writerKeyFingerprint: "fp-alice",
        characterCount: 2,
        directCharacterCount: 2,
        baselineCharacterCount: 0,
        hasDirectAuthority: true,
        hasBaselineAuthority: false,
      },
      {
        writerUserId: "bob",
        writerKeyFingerprint: "fp-bob",
        characterCount: 1,
        directCharacterCount: 1,
        baselineCharacterCount: 0,
        hasDirectAuthority: true,
        hasBaselineAuthority: false,
      },
      {
        writerUserId: "carol",
        writerKeyFingerprint: "fp-carol",
        characterCount: 1,
        directCharacterCount: 0,
        baselineCharacterCount: 1,
        hasDirectAuthority: false,
        hasBaselineAuthority: true,
      },
    ],
    totalCharacterCount: 5,
    unattributedCharacterCount: 1,
  });
});

test("summarizeCharacterBlame flags a writer credited both directly and via baseline", () => {
  const [writer] = summarizeCharacterBlame(
    [
      { peerId: "1", counter: 0 },
      { peerId: "5", counter: 0 },
    ],
    [
      segment({
        peerId: "1",
        startCounter: 0,
        endCounter: 1,
        writerUserId: "alice",
      }),
      segment({
        peerId: "5",
        startCounter: 0,
        endCounter: 1,
        writerUserId: "alice",
        authorityKind: "baseline",
      }),
    ],
  ).writers;
  expect(writer).toEqual({
    writerUserId: "alice",
    writerKeyFingerprint: "fp-alice",
    characterCount: 2,
    directCharacterCount: 1,
    baselineCharacterCount: 1,
    hasDirectAuthority: true,
    hasBaselineAuthority: true,
  });
});

test("summarizeCharacterBlame returns an empty summary for empty input", () => {
  expect(summarizeCharacterBlame([], [])).toEqual({
    writers: [],
    totalCharacterCount: 0,
    unattributedCharacterCount: 0,
  });
});

test("summarizeBlameRanges coalesces consecutive same-writer code points into runs", () => {
  const segments = [
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 2,
      writerUserId: "alice",
    }),
    segment({
      peerId: "1",
      startCounter: 2,
      endCounter: 4,
      writerUserId: "bob",
    }),
  ];
  const ranges = summarizeBlameRanges(
    blameSource([
      ["H", "1", 0], // alice
      ["i", "1", 1], // alice
      ["B", "1", 2], // bob
      ["o", "1", 3], // bob
      ["?", "9", 0], // no segment covers peer 9 -> unattributed
    ]),
    segments,
  );
  expect(ranges).toEqual([
    {
      startIndex: 0,
      endIndex: 2,
      text: "Hi",
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
      authorityKind: "direct",
    },
    {
      startIndex: 2,
      endIndex: 4,
      text: "Bo",
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
      authorityKind: "direct",
    },
    {
      startIndex: 4,
      endIndex: 5,
      text: "?",
      writerUserId: null,
      writerKeyFingerprint: null,
      authorityKind: null,
    },
  ]);
});

test("summarizeBlameRanges splits the same writer across direct and re-asserted runs", () => {
  const ranges = summarizeBlameRanges(
    blameSource([
      ["a", "1", 0],
      ["b", "1", 1],
      ["c", "1", 2],
    ]),
    [
      segment({
        peerId: "1",
        startCounter: 0,
        endCounter: 2,
        writerUserId: "alice",
      }),
      segment({
        peerId: "1",
        startCounter: 2,
        endCounter: 3,
        writerUserId: "alice",
        authorityKind: "baseline",
      }),
    ],
  );
  expect(ranges.map((range) => [range.text, range.authorityKind])).toEqual([
    ["ab", "direct"],
    ["c", "baseline"],
  ]);
});

test("summarizeBlameRanges splits the same user across distinct signing keys", () => {
  const ranges = summarizeBlameRanges(
    blameSource([
      ["a", "1", 0],
      ["b", "2", 0],
    ]),
    [
      segment({
        peerId: "1",
        startCounter: 0,
        endCounter: 1,
        writerUserId: "alice",
        writerKeyFingerprint: "fp-key-1",
      }),
      segment({
        peerId: "2",
        startCounter: 0,
        endCounter: 1,
        writerUserId: "alice",
        writerKeyFingerprint: "fp-key-2",
      }),
    ],
  );
  expect(
    ranges.map((range) => [range.text, range.writerKeyFingerprint]),
  ).toEqual([
    ["a", "fp-key-1"],
    ["b", "fp-key-2"],
  ]);
});

test("summarizeBlameRanges returns no runs for empty prose", () => {
  expect(summarizeBlameRanges(blameSource([]), [])).toEqual([]);
});

test("summarizeFieldBlame resolves each field's last editor, sorted by key", () => {
  const segments = [
    segment({
      peerId: "1",
      startCounter: 0,
      endCounter: 5,
      writerUserId: "alice",
    }),
    segment({
      peerId: "2",
      startCounter: 0,
      endCounter: 5,
      writerUserId: "bob",
    }),
  ];
  expect(
    summarizeFieldBlame(
      [
        { key: "lastName", peerId: "2" },
        { key: "firstName", peerId: "1" },
        { key: "nickname", peerId: "9" }, // no segment covers peer 9
      ],
      segments,
    ),
  ).toEqual([
    {
      fieldKey: "firstName",
      writerUserId: "alice",
      writerKeyFingerprint: "fp-alice",
    },
    {
      fieldKey: "lastName",
      writerUserId: "bob",
      writerKeyFingerprint: "fp-bob",
    },
    { fieldKey: "nickname", writerUserId: null, writerKeyFingerprint: null },
  ]);
});

test("summarizeFieldBlame leaves an ambiguous split peer unattributed", () => {
  const segments = [
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
  ];
  expect(summarizeFieldBlame([{ key: "note", peerId: "1" }], segments)).toEqual(
    [{ fieldKey: "note", writerUserId: null, writerKeyFingerprint: null }],
  );
});
