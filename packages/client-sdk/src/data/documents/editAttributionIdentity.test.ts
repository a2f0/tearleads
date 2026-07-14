import { expect, test } from "bun:test";
import {
  type DocumentAttributionInterval,
  summarizeDocumentBlame,
  summarizeDocumentContributors,
  summarizeFieldBlame,
  writerByPeerId,
} from "./editAttribution";

function interval(
  overrides: Partial<DocumentAttributionInterval> &
    Pick<DocumentAttributionInterval, "peerId" | "startCounter" | "endCounter">,
): DocumentAttributionInterval {
  return {
    writerUserId: "alice",
    writerKeyFingerprint: "fp-1",
    authorityKind: "direct",
    ...overrides,
  };
}

test("contributors keep signing keys separate and expose authority totals", () => {
  const contributors = summarizeDocumentContributors([
    interval({ peerId: "1", startCounter: 0, endCounter: 2 }),
    interval({
      peerId: "1",
      startCounter: 2,
      endCounter: 5,
      authorityKind: "baseline",
    }),
    interval({
      peerId: "2",
      startCounter: 0,
      endCounter: 4,
      writerKeyFingerprint: "fp-2",
    }),
  ]);

  expect(contributors).toEqual([
    {
      writerUserId: "alice",
      writerKeyFingerprint: "fp-1",
      opCount: 5,
      directOpCount: 2,
      baselineOpCount: 3,
      hasDirectAuthority: true,
      hasBaselineAuthority: true,
    },
    {
      writerUserId: "alice",
      writerKeyFingerprint: "fp-2",
      opCount: 4,
      directOpCount: 4,
      baselineOpCount: 0,
      hasDirectAuthority: true,
      hasBaselineAuthority: false,
    },
  ]);
});

test("combined blame derives identity totals and prose ranges in one result", () => {
  const result = summarizeDocumentBlame(
    {
      codePoints: ["a", "b", "c", "?"],
      opIds: [
        { peerId: "1", counter: 0 },
        { peerId: "1", counter: 1 },
        { peerId: "1", counter: 2 },
        { peerId: "9", counter: 0 },
      ],
    },
    [
      interval({
        peerId: "1",
        startCounter: 2,
        endCounter: 3,
        writerKeyFingerprint: "fp-2",
        authorityKind: "baseline",
      }),
      interval({ peerId: "1", startCounter: 0, endCounter: 2 }),
    ],
  );

  expect(result.characterBlame).toEqual({
    writers: [
      {
        writerUserId: "alice",
        writerKeyFingerprint: "fp-1",
        characterCount: 2,
        directCharacterCount: 2,
        baselineCharacterCount: 0,
        hasDirectAuthority: true,
        hasBaselineAuthority: false,
      },
      {
        writerUserId: "alice",
        writerKeyFingerprint: "fp-2",
        characterCount: 1,
        directCharacterCount: 0,
        baselineCharacterCount: 1,
        hasDirectAuthority: false,
        hasBaselineAuthority: true,
      },
    ],
    totalCharacterCount: 4,
    unattributedCharacterCount: 1,
  });
  expect(
    result.blameRanges.map(({ text, writerKeyFingerprint }) => [
      text,
      writerKeyFingerprint,
    ]),
  ).toEqual([
    ["ab", "fp-1"],
    ["c", "fp-2"],
    ["?", null],
  ]);
});

test("field blame is conservative when one peer has multiple signing keys", () => {
  const segments = [
    interval({ peerId: "1", startCounter: 0, endCounter: 2 }),
    interval({
      peerId: "1",
      startCounter: 2,
      endCounter: 4,
      writerKeyFingerprint: "fp-2",
    }),
  ];

  expect(writerByPeerId(segments).get("1")).toBeNull();
  expect(
    summarizeFieldBlame([{ key: "title", peerId: "1" }], segments),
  ).toEqual([
    { fieldKey: "title", writerUserId: null, writerKeyFingerprint: null },
  ]);
  expect(summarizeFieldBlame([{ key: "empty", peerId: null }], [])).toEqual([
    { fieldKey: "empty", writerUserId: null, writerKeyFingerprint: null },
  ]);
});

test("field blame keeps an identity across direct and baseline intervals", () => {
  const segments = [
    interval({ peerId: "1", startCounter: 0, endCounter: 2 }),
    interval({
      peerId: "1",
      startCounter: 2,
      endCounter: 4,
      authorityKind: "baseline",
    }),
  ];

  expect(writerByPeerId(segments).get("1")).toEqual({
    writerUserId: "alice",
    writerKeyFingerprint: "fp-1",
  });
});

test("whole-document blame handles many unsorted intervals", () => {
  const intervalCount = 10_000;
  const segments = Array.from({ length: intervalCount }, (_, index) =>
    interval({ peerId: "1", startCounter: index, endCounter: index + 1 }),
  ).reverse();
  const codePoints = Array.from({ length: intervalCount }, () => "x");
  const opIds = codePoints.map((_, counter) => ({ peerId: "1", counter }));

  const result = summarizeDocumentBlame({ codePoints, opIds }, segments);

  expect(result.characterBlame.writers[0]?.characterCount).toBe(intervalCount);
  expect(result.blameRanges).toHaveLength(1);
  expect(result.blameRanges[0]?.text).toHaveLength(intervalCount);
});
