// What a reader holds a server to when it serves a rotation baseline: the
// malformed groups below are every way a server can present one whose
// segments are each authentic.
import { expect, test } from "bun:test";
import { computeDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { BaselineGroupRun } from "./baselineGroupMachine";
import { isColdPull, judgeServedBaselineGroups } from "./baselineGroupProgress";
import { isDocumentSyncUpdateIsolationError } from "./documentSyncUpdateIsolation";

type ServedUpdate = DocumentSyncResponse["updates"][number];

const DOCUMENT_ID = "6f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e";
const WARM = encodeVersionVectorCounters({ "7": 3 });

/** A served update with the fields the group rules read, and no payload. */
function served(
  id: string,
  baseline: Partial<ServedUpdate> = {},
): ServedUpdate {
  return {
    accessEpoch: 2,
    authorFingerprint: "writer",
    createdAt: "2026-04-27T00:00:00.000Z",
    dependencyVersionVector: emptyVersionVector(),
    documentId: DOCUMENT_ID,
    encryptedData: "ciphertext",
    id,
    partialEndVersionVector: emptyVersionVector(),
    partialStartVersionVector: emptyVersionVector(),
    plaintextHash: "plaintext",
    writeHeader: {
      ciphertextHash: `ciphertext-${id}`,
      metadataHash: `metadata-${id}`,
    },
    ...baseline,
  };
}

/** A whole group of `count` segments, sealed as its writer seals it. */
async function group(
  baselineId: string,
  count: number,
): Promise<ServedUpdate[]> {
  const segments = Array.from({ length: count }, (_, index) =>
    served(`${baselineId}-segment-${index}`, {
      baselineId,
      baselineSegmentIndex: index,
    }),
  );
  const final = segments.at(-1);
  if (!final) throw new Error("No segments");
  return [
    ...segments.slice(0, -1),
    {
      ...final,
      baselineSegmentCount: count,
      baselineSegmentsDigest: await computeDocumentBaselineSegmentsDigest({
        baselineId,
        documentId: DOCUMENT_ID,
        segments: segments.slice(0, -1).map((segment) => ({
          ciphertextHash: `ciphertext-${segment.id}`,
          metadataHash: `metadata-${segment.id}`,
          updateId: segment.id,
        })),
      }),
    },
  ];
}

function judge(
  updates: readonly ServedUpdate[],
  options: {
    localVersionVector?: string | null;
    pullComplete?: boolean;
    run?: BaselineGroupRun | null;
  } = {},
) {
  return judgeServedBaselineGroups({
    documentId: DOCUMENT_ID,
    localVersionVector:
      options.localVersionVector === undefined
        ? null
        : options.localVersionVector,
    pullComplete: options.pullComplete ?? true,
    run: options.run ?? null,
    updates,
  });
}

/** The reason a judged page fails, or null when it passes. */
async function failure(
  ...args: Parameters<typeof judge>
): Promise<string | null> {
  try {
    await judge(...args);
    return null;
  } catch (error) {
    if (!isDocumentSyncUpdateIsolationError(error)) throw error;
    // The server's serving is at fault, not one update: never a void.
    expect(error.attribution).toBe("batch");
    expect(error.updateId).toBeNull();
    expect(error.batchUpdateIds).toEqual(args[0].map((update) => update.id));
    return error.message.replace(/^.*not a whole rotation baseline: /u, "");
  }
}

function at(updates: readonly ServedUpdate[], index: number): ServedUpdate {
  const update = updates[index];
  if (!update) throw new Error(`No update ${index}`);
  return update;
}

test("a pull with no version, or an empty one, is cold", () => {
  expect(isColdPull(null)).toBe(true);
  expect(isColdPull(emptyVersionVector())).toBe(true);
  expect(isColdPull(WARM)).toBe(false);
  expect(isColdPull("not-a-vector")).toBe(false);
});

test("a whole group passes, among ordinary updates and other groups", async () => {
  const first = await group("baseline-a", 3);
  const second = await group("baseline-b", 1);
  expect(
    await judge([
      served("before"),
      ...first,
      served("between"),
      ...second,
      served("after"),
    ]),
  ).toBeNull();
  expect(await judge([])).toBeNull();
  expect(await judge([served("only")], { pullComplete: false })).toBeNull();
});

test("a cold reader fails the pass on each malformed group a server can present", async () => {
  const whole = await group("baseline-a", 4);
  const other = await group("baseline-b", 4);
  const [s0, s1, s2, s3] = whole;
  if (!s0 || !s1 || !s2 || !s3) throw new Error("Expected four segments");
  const cases: [string, ServedUpdate[], string][] = [
    ["reordered", [s0, s2, s1, s3], "were not served in index order"],
    ["repeated", [s0, s1, s1, s2, s3], "were not served in index order"],
    ["missing middle", [s0, s1, s3], "were not served in index order"],
    [
      "missing final",
      [s0, s1, s2],
      "the pull ended inside a rotation baseline",
    ],
    [
      "missing final, then other updates",
      [s0, s1, s2, served("after")],
      "another update was served between",
    ],
    [
      "interleaved",
      [s0, s1, served("between"), s2, s3],
      "another update was served between",
    ],
    [
      "mixed baselines",
      [s0, s1, at(other, 2), s3],
      "a segment of another rotation baseline was served inside one",
    ],
    [
      "wrong count",
      [s0, s1, s2, { ...s3, baselineSegmentCount: 5 }],
      "signs a count that does not fit its index",
    ],
    [
      "wrong digest",
      [s0, s1, s2, { ...s3, baselineSegmentsDigest: "0".repeat(64) }],
      "signs another digest than its served segments have",
    ],
    [
      "another group's digest",
      [
        s0,
        s1,
        s2,
        { ...s3, baselineSegmentsDigest: at(other, 3).baselineSegmentsDigest },
      ],
      "signs another digest than its served segments have",
    ],
    [
      "a replaced segment",
      [s0, { ...s1, id: "replacement" }, s2, s3],
      "signs another digest than its served segments have",
    ],
    [
      "a segment with another header",
      [
        s0,
        { ...s1, writeHeader: { ...s1.writeHeader, metadataHash: "x" } },
        s2,
        s3,
      ],
      "signs another digest than its served segments have",
    ],
  ];
  for (const [name, updates, reason] of cases) {
    const reported = await failure(updates);
    expect([name, reported?.includes(reason), reported]).toEqual([
      name,
      true,
      reported,
    ]);
  }
  // A one-segment group whose digest is not the start digest.
  const [single] = await group("baseline-c", 1);
  if (!single) throw new Error("Expected a segment");
  expect(
    await failure([{ ...single, baselineSegmentsDigest: "0".repeat(64) }]),
  ).toContain("signs another digest");
  expect(await failure([{ ...single, baselineSegmentCount: 2 }])).toContain(
    "signs a count that does not fit its index",
  );
});

test("a cold reader follows a group across pages through the run", async () => {
  const whole = await group("baseline-a", 5);
  const firstRun = await judge(whole.slice(0, 2), { pullComplete: false });
  expect(firstRun).toMatchObject({ baselineId: "baseline-a", nextIndex: 2 });
  // The next pages are sent with the version the first one built.
  const secondRun = await judge(whole.slice(2, 4), {
    localVersionVector: WARM,
    pullComplete: false,
    run: firstRun,
  });
  expect(secondRun).toMatchObject({ baselineId: "baseline-a", nextIndex: 4 });
  expect(
    await judge([at(whole, 4), served("after")], {
      localVersionVector: WARM,
      run: secondRun,
    }),
  ).toBeNull();

  // A page that does not go on where the run stopped fails the pass.
  const warm = { localVersionVector: WARM, run: firstRun };
  expect(await failure(whole.slice(3), warm)).toContain(
    "were not served in index order",
  );
  expect(await failure([served("ordinary")], warm)).toContain(
    "another update was served between",
  );
  expect(await failure([], warm)).toContain("the pull ended inside");
  expect(
    await failure(whole.slice(2, 4), { ...warm, pullComplete: true }),
  ).toContain("the pull ended inside");
  // An empty page that is not the last carries the run on unchanged.
  expect(await judge([], { ...warm, pullComplete: false })).toEqual(firstRun);
  // The digest spans pages: a later page's segment replaced fails the seal.
  expect(
    await failure(
      [{ ...at(whole, 2), id: "replacement" }, at(whole, 3), at(whole, 4)],
      warm,
    ),
  ).toContain("signs another digest");
});

test("a reader that sent a version is held to what it can know", async () => {
  const whole = await group("baseline-a", 5);
  const warm = { localVersionVector: WARM };
  // The server leaves out segments this reader's version holds.
  for (const picked of [[0, 2, 4], [1, 3], [3], [0, 1], [4]]) {
    expect(
      await judge(
        picked.map((index) => at(whole, index)),
        warm,
      ),
    ).toBeNull();
  }
  // Indices still only rise, and the final segment's count fits its index.
  expect(await failure([at(whole, 3), at(whole, 1)], warm)).toContain(
    "were not served in index order",
  );
  expect(
    await failure(
      [at(whole, 1), { ...at(whole, 4), baselineSegmentCount: 9 }],
      warm,
    ),
  ).toContain("signs a count that does not fit its index");
  // A group it is served from the start is not followed whole, so it carries
  // no run, and a skipped segment is no failure.
  expect(
    await judge([at(whole, 0), at(whole, 1)], {
      ...warm,
      pullComplete: false,
    }),
  ).toBeNull();
});
