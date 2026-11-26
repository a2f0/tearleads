import { expect, test } from "bun:test";
import { MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH } from "@tearleads/validators/util";
import {
  continuedBaselineGroupRun,
  deserializeDocumentSyncPullContinuation,
  documentSyncPullContinuationsEqual,
  serializeDocumentSyncPullContinuation,
} from "./pullContinuation";

const RUN = {
  baselineId: "baseline-1",
  digest: "ab".repeat(32),
  nextIndex: 3,
  unapplied: false,
};

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
      2,
      "tracked",
      "0/2A",
      "page-2",
      ["baseline-1", 3, RUN.digest, 0],
    ]),
  );
  expect(deserializeDocumentSyncPullContinuation(stored)).toEqual(continuation);
  // A group followed in part has no digest, and either kind remembers that
  // one of its segments went unapplied.
  for (const run of [
    { ...RUN, digest: null },
    { ...RUN, unapplied: true },
    { ...RUN, digest: null, unapplied: true },
  ]) {
    const carried = { ...continuation, baselineGroupRun: run };
    expect(
      deserializeDocumentSyncPullContinuation(
        serializeDocumentSyncPullContinuation(carried),
      ),
    ).toEqual(carried);
  }
  // No run is stored as null, and read back as no run.
  for (const baselineGroupRun of [null, undefined]) {
    const without = serializeDocumentSyncPullContinuation({
      ...continuation,
      baselineGroupRun,
    });
    expect(without).toBe(
      JSON.stringify([2, "tracked", "0/2A", "page-2", null]),
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
    { ...base, baselineGroupRun: { ...RUN, nextIndex: 4, unapplied: false } },
    { ...base, baselineGroupRun: { ...RUN, digest: "cd".repeat(32) } },
    { ...base, baselineGroupRun: { ...RUN, baselineId: "baseline-2" } },
  ]) {
    expect(documentSyncPullContinuationsEqual(withRun, other)).toBe(false);
  }
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
    JSON.stringify([2, "tracked", "0/2", "page-2"]),
    JSON.stringify([3, "tracked", "0/2", "page-2", null]),
    JSON.stringify([2, "tracked", "not-an-lsn", "page-2", null]),
    JSON.stringify([2, "tracked", "0/0", "page-2", null]),
    JSON.stringify([2, "untracked", "0/2", "page-2", null]),
    JSON.stringify([2, "tracked", "0/2", "", null]),
    JSON.stringify([
      2,
      "tracked",
      "0/2",
      "x".repeat(MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH + 1),
      null,
    ]),
    // A run that is not one: a pull cannot be held to it, so it restarts.
    JSON.stringify([2, "tracked", "0/2", "page-2", "run"]),
    JSON.stringify([2, "tracked", "0/2", "page-2", ["baseline-1", 3]]),
    JSON.stringify([2, "tracked", "0/2", "page-2", ["", 3, RUN.digest]]),
    JSON.stringify([2, "tracked", "0/2", "page-2", ["baseline-1", 0, "d"]]),
    JSON.stringify([2, "tracked", "0/2", "page-2", ["baseline-1", 1.5, "d"]]),
    JSON.stringify([2, "tracked", "0/2", "page-2", ["baseline-1", 3, ""]]),
  ]) {
    expect(deserializeDocumentSyncPullContinuation(value)).toBeNull();
  }
});
