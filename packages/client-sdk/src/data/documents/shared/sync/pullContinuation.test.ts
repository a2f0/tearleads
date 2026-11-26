import { expect, test } from "bun:test";
import { MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH } from "@tearleads/validators/util";
import type { BaselineGroupRun } from "./baselineGroupMachine";
import { isColdPullPage } from "./baselineGroupProgress";
import { MAX_UNAPPLIED_BASELINE_SPANS } from "./baselineGroupUnapplied";
import {
  continuedBaselineGroupRun,
  type DocumentSyncPullContinuation,
  deserializeDocumentSyncPullContinuation,
  documentSyncPullContinuationsEqual,
  pullPageRequest,
  serializeDocumentSyncPullContinuation,
} from "./pullContinuation";

const RUN: BaselineGroupRun = {
  baselineId: "baseline-1",
  digest: "ab".repeat(32),
  nextIndex: 3,
  unapplied: [],
};

/** What two unapplied segments declared: one span a peer, in peer order. */
const FIRST_UNAPPLIED = {
  endCounter: 12,
  peerId: "18446744073709551615",
  startCounter: 4,
};
const SECOND_UNAPPLIED = { endCounter: 9, peerId: "7", startCounter: 0 };
const UNAPPLIED = [FIRST_UNAPPLIED, SECOND_UNAPPLIED];

test("document pull continuations round-trip through durable storage", () => {
  const continuation = {
    commitLsn: "0/2A",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };

  expect(
    deserializeDocumentSyncPullContinuation(
      serializeDocumentSyncPullContinuation(continuation),
    ),
  ).toEqual(continuation);
  expect(
    deserializeDocumentSyncPullContinuation(
      serializeDocumentSyncPullContinuation({
        commitLsn: "0/0",
        commitLsnMode: "untracked",
        cursor: "turso-page-2",
      }),
    ),
  ).toEqual({
    commitLsn: "0/0",
    commitLsnMode: "untracked",
    cursor: "turso-page-2",
  });
});

// A page can end inside a rotation baseline the pull follows whole. The
// continuation carries where the baseline's next segment must be and the
// digest so far, so a restart between pages still checks the rest.
test("a continuation carries the rotation baseline its page ended inside", () => {
  const continuation = {
    baselineGroupRun: RUN,
    commitLsn: "0/2A",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const stored = serializeDocumentSyncPullContinuation(continuation);
  expect(stored).toBe(
    JSON.stringify([
      3,
      "tracked",
      "0/2A",
      "page-2",
      ["baseline-1", 3, RUN.digest, []],
    ]),
  );
  expect(deserializeDocumentSyncPullContinuation(stored)).toEqual(continuation);
  // A group followed in part has no digest, and either kind remembers the
  // operations its unapplied segments declared.
  for (const run of [
    { ...RUN, digest: null },
    { ...RUN, unapplied: UNAPPLIED },
    { ...RUN, digest: null, unapplied: UNAPPLIED },
  ]) {
    const carried = { ...continuation, baselineGroupRun: run };
    expect(
      deserializeDocumentSyncPullContinuation(
        serializeDocumentSyncPullContinuation(carried),
      ),
    ).toEqual(carried);
  }
  expect(
    serializeDocumentSyncPullContinuation({
      ...continuation,
      baselineGroupRun: { ...RUN, unapplied: UNAPPLIED },
    }),
  ).toBe(
    JSON.stringify([
      3,
      "tracked",
      "0/2A",
      "page-2",
      [
        "baseline-1",
        3,
        RUN.digest,
        [
          ["18446744073709551615", 4, 12],
          ["7", 0, 9],
        ],
      ],
    ]),
  );
  // No run is stored as null, and read back as no run.
  for (const baselineGroupRun of [null, undefined]) {
    const without = serializeDocumentSyncPullContinuation({
      ...continuation,
      baselineGroupRun,
    });
    expect(without).toBe(
      JSON.stringify([3, "tracked", "0/2A", "page-2", null]),
    );
    expect(deserializeDocumentSyncPullContinuation(without)).toEqual({
      commitLsn: "0/2A",
      commitLsnMode: "tracked",
      cursor: "page-2",
    });
  }
});

test("continuations with different runs are different continuations", () => {
  const base = {
    commitLsn: "0/2A",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const withRun = { ...base, baselineGroupRun: RUN };
  expect(documentSyncPullContinuationsEqual(withRun, { ...withRun })).toBe(
    true,
  );
  expect(
    documentSyncPullContinuationsEqual(base, {
      ...base,
      baselineGroupRun: null,
    }),
  ).toBe(true);
  for (const other of [
    base,
    { ...base, baselineGroupRun: { ...RUN, nextIndex: 4 } },
    { ...base, baselineGroupRun: { ...RUN, unapplied: UNAPPLIED } },
    { ...base, baselineGroupRun: { ...RUN, digest: "cd".repeat(32) } },
    { ...base, baselineGroupRun: { ...RUN, baselineId: "baseline-2" } },
  ]) {
    expect(documentSyncPullContinuationsEqual(withRun, other)).toBe(false);
  }
  // The unapplied operations are part of the run: each span counts.
  const marked = {
    ...base,
    baselineGroupRun: { ...RUN, unapplied: UNAPPLIED },
  };
  expect(
    documentSyncPullContinuationsEqual(marked, {
      ...base,
      baselineGroupRun: { ...RUN, unapplied: [...UNAPPLIED] },
    }),
  ).toBe(true);
  for (const unapplied of [
    [FIRST_UNAPPLIED],
    [FIRST_UNAPPLIED, { ...SECOND_UNAPPLIED, endCounter: 10 }],
    [FIRST_UNAPPLIED, { ...SECOND_UNAPPLIED, startCounter: 1 }],
    [FIRST_UNAPPLIED, { ...SECOND_UNAPPLIED, peerId: "8" }],
  ]) {
    expect(
      documentSyncPullContinuationsEqual(marked, {
        ...base,
        baselineGroupRun: { ...RUN, unapplied },
      }),
    ).toBe(false);
  }
});

// The pass asks for a page and judges it from one state: the run its own
// cursor continues, read by the machine. A page asked for with no version is
// one the judge holds to a whole group, and no other is.
test("a page is judged as it was asked for", () => {
  const WARM = "AQEAAQ==";
  const base = {
    commitLsn: "0/2A",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const cases: [DocumentSyncPullContinuation | null, boolean][] = [
    [null, false],
    [base, false],
    [{ ...base, baselineGroupRun: null }, false],
    [{ ...base, baselineGroupRun: { ...RUN, digest: null } }, false],
    [{ ...base, baselineGroupRun: RUN }, true],
    [{ ...base, baselineGroupRun: { ...RUN, unapplied: UNAPPLIED } }, true],
  ];
  for (const [continuation, whole] of cases) {
    const request = pullPageRequest(WARM, continuation);
    expect(request).toEqual({
      localVersionVector: whole ? null : WARM,
      pullCursor: continuation?.cursor,
    });
    expect(
      isColdPullPage({
        ...request,
        run: continuedBaselineGroupRun(continuation, request.pullCursor),
      }),
    ).toBe(whole);
  }
  // A reader with no version asks for every page with none.
  expect(pullPageRequest(null, base)).toEqual({
    localVersionVector: null,
    pullCursor: "page-2",
  });
});

test("a run continues only on the cursor it was recorded with", () => {
  const continuation = {
    baselineGroupRun: RUN,
    commitLsn: "0/2A",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  expect(continuedBaselineGroupRun(continuation, "page-2")).toEqual(RUN);
  // A request sent with no cursor, or another one, starts its pull over.
  expect(continuedBaselineGroupRun(continuation, undefined)).toBeNull();
  expect(continuedBaselineGroupRun(continuation, "page-3")).toBeNull();
  expect(continuedBaselineGroupRun(undefined, undefined)).toBeNull();
  expect(continuedBaselineGroupRun(null, "page-2")).toBeNull();
  expect(
    continuedBaselineGroupRun(
      { ...continuation, baselineGroupRun: null },
      "page-2",
    ),
  ).toBeNull();
});

test("malformed durable pull progress safely restarts from page one", () => {
  for (const value of [
    "not-json",
    // The shape before a continuation carried a run.
    JSON.stringify([1, "tracked", "0/2", "page-2"]),
    JSON.stringify([3, "tracked", "0/2", "page-2"]),
    JSON.stringify([4, "tracked", "0/2", "page-2", null]),
    // The format before a run stored its unapplied operations as spans: a
    // continuation is read only in the format that wrote it.
    JSON.stringify([2, "tracked", "0/2", "page-2", null]),
    JSON.stringify([
      2,
      "tracked",
      "0/2",
      "page-2",
      ["baseline-1", 3, RUN.digest, [["7", 0, 9]]],
    ]),
    JSON.stringify([3, "tracked", "not-an-lsn", "page-2", null]),
    JSON.stringify([3, "tracked", "0/0", "page-2", null]),
    JSON.stringify([3, "untracked", "0/2", "page-2", null]),
    JSON.stringify([3, "tracked", "0/2", "", null]),
    JSON.stringify([
      3,
      "tracked",
      "0/2",
      "x".repeat(MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH + 1),
      null,
    ]),
    // A run that is not one: a pull cannot be held to it, so it restarts.
    JSON.stringify([3, "tracked", "0/2", "page-2", "run"]),
    JSON.stringify([3, "tracked", "0/2", "page-2", ["baseline-1", 3]]),
    JSON.stringify([3, "tracked", "0/2", "page-2", ["", 3, RUN.digest]]),
    JSON.stringify([3, "tracked", "0/2", "page-2", ["baseline-1", 0, "d"]]),
    JSON.stringify([3, "tracked", "0/2", "page-2", ["baseline-1", 1.5, "d"]]),
    JSON.stringify([3, "tracked", "0/2", "page-2", ["baseline-1", 3, ""]]),
    // The mark before a run carried what its unapplied segments declared.
    JSON.stringify([3, "tracked", "0/2", "page-2", ["baseline-1", 3, "d", 1]]),
    // Unapplied operations that are not spans, one a peer, in peer order.
    ...[
      [["7", 0]],
      [["seven", 0, 9]],
      // A peer id is an unsigned 64-bit integer, spelled one way.
      [["07", 0, 9]],
      [["+7", 0, 9]],
      [["7.0", 0, 9]],
      [["18446744073709551616", 0, 9]],
      [["184467440737095516150", 0, 9]],
      [["7", -1, 9]],
      [["7", 0.5, 9]],
      [["7", 9, 9]],
      [["7", 9, 4]],
      [["7", "0", 9]],
      ["7"],
      [
        ["7", 0, 9],
        ["7", 9, 12],
      ],
      [
        ["8", 0, 9],
        ["7", 0, 9],
      ],
    ].map((unapplied) =>
      JSON.stringify([
        3,
        "tracked",
        "0/2",
        "page-2",
        ["baseline-1", 3, "d", unapplied],
      ]),
    ),
  ]) {
    expect(deserializeDocumentSyncPullContinuation(value)).toBeNull();
  }
});

test("a stored run carries no more spans than a pull may carry", () => {
  const stored = (count: number) =>
    JSON.stringify([
      3,
      "tracked",
      "0/2",
      "page-2",
      [
        "baseline-1",
        3,
        RUN.digest,
        Array.from({ length: count }, (_, n) => [String(10_000_000 + n), 0, 1]),
      ],
    ]);
  expect(
    deserializeDocumentSyncPullContinuation(
      stored(MAX_UNAPPLIED_BASELINE_SPANS),
    )?.baselineGroupRun?.unapplied,
  ).toHaveLength(MAX_UNAPPLIED_BASELINE_SPANS);
  expect(
    deserializeDocumentSyncPullContinuation(
      stored(MAX_UNAPPLIED_BASELINE_SPANS + 1),
    ),
  ).toBeNull();
});
