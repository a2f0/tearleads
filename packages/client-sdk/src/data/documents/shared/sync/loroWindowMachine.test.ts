import { expect, test } from "bun:test";
import {
  judgeOrphanWindow,
  LORO_ISOLATION_FREE,
  type LoroWindow,
  loroIsolationPageLimit,
  loroWindowCounts,
  transitionLoroIsolation,
} from "./loroWindowMachine";

const WINDOW: LoroWindow = {
  contentKeyEpoch: 2,
  counts: true,
  documentId: "doc",
  judge: "judge",
  keyFingerprint: "key",
  lifetimeId: "dead",
  updateIds: ["u1"],
};
const CONTEXT = {
  documentId: "doc",
  endedFailed: false,
  endedHidden: false,
  judge: "judge",
};

test("a window counts only for one update in a lifetime that has not failed", () => {
  expect(loroWindowCounts(1, false)).toBe(true);
  expect(loroWindowCounts(2, false)).toBe(false);
  expect(loroWindowCounts(1, true)).toBe(false);
});

test("an orphan counts, isolates, or says nothing", () => {
  expect(judgeOrphanWindow(WINDOW, CONTEXT)).toEqual({
    kind: "count",
    contentKeyEpoch: 2,
    keyFingerprint: "key",
    updateId: "u1",
  });
  expect(
    judgeOrphanWindow({ ...WINDOW, updateIds: ["u1", "u2"] }, CONTEXT),
  ).toEqual({ kind: "isolate", suspects: ["u1", "u2"] });
  for (const [window, context] of [
    [{ ...WINDOW, counts: false }, CONTEXT],
    [WINDOW, { ...CONTEXT, endedFailed: true }],
  ] as const) {
    expect(judgeOrphanWindow(window, context)).toEqual({
      kind: "isolate",
      suspects: ["u1"],
    });
  }
  for (const context of [
    { ...CONTEXT, endedHidden: true },
    { ...CONTEXT, judge: "newer" },
    { ...CONTEXT, documentId: "rebound" },
  ]) {
    expect(judgeOrphanWindow(WINDOW, context)).toEqual({ kind: "discard" });
  }
});

test("isolation clears as pages serve its suspects or the pull completes", () => {
  const isolating = transitionLoroIsolation(LORO_ISOLATION_FREE, {
    type: "orphanIsolated",
    documentId: "doc",
    suspects: ["u1", "u2"],
  });
  expect(loroIsolationPageLimit(isolating, "doc")).toBe(1);
  expect(loroIsolationPageLimit(isolating, "other")).toBeUndefined();
  const served = (ids: string[], pullCompleted = false) =>
    transitionLoroIsolation(isolating, {
      type: "pageCommitted",
      documentId: "doc",
      pullCompleted,
      passedUpdateIds: ids,
    });
  expect(served(["u1"])).toEqual({
    status: "isolating",
    documentId: "doc",
    suspects: ["u2"],
  });
  expect(served(["u1", "u2"])).toEqual(LORO_ISOLATION_FREE);
  expect(served([], true)).toEqual(LORO_ISOLATION_FREE);
});
