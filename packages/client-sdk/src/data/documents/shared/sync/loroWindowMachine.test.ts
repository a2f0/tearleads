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
  counts: true,
  documentId: "doc",
  judge: "judge",
  kind: "read",
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
  expect(loroWindowCounts("read", 1, false)).toBe(true);
  expect(loroWindowCounts("read", 2, false)).toBe(false);
  expect(loroWindowCounts("read", 1, true)).toBe(false);
});

test("a rotation window counts toward the rotation whatever its page held", () => {
  expect(loroWindowCounts("rotation", 1, false)).toBe(true);
  expect(loroWindowCounts("rotation", 2, false)).toBe(true);
  expect(loroWindowCounts("rotation", 1, true)).toBe(false);
});

test("a rotation orphan charges the rotation, never an update", () => {
  const rotation: LoroWindow = { ...WINDOW, kind: "rotation" };
  expect(judgeOrphanWindow(rotation, CONTEXT)).toEqual({
    kind: "rotationDeath",
    suspects: ["u1"],
  });
  expect(
    judgeOrphanWindow({ ...rotation, updateIds: ["u1", "u2"] }, CONTEXT),
  ).toEqual({ kind: "rotationDeath", suspects: ["u1", "u2"] });
  for (const [window, context] of [
    [{ ...rotation, counts: false }, CONTEXT],
    [rotation, { ...CONTEXT, endedFailed: true }],
  ] as const) {
    expect(judgeOrphanWindow(window, context)).toEqual({
      kind: "isolate",
      suspects: ["u1"],
    });
  }
  expect(
    judgeOrphanWindow(rotation, { ...CONTEXT, endedHidden: true }),
  ).toEqual({ kind: "discard" });
});

test("an orphan counts, isolates, or says nothing", () => {
  expect(judgeOrphanWindow(WINDOW, CONTEXT)).toEqual({
    kind: "count",
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
