import { expect, test } from "bun:test";
import { processedCursorTransition } from "./processedCursorState";

const FRONTIER = "frontier";
const completed = (cursorSent: boolean, throughUpdateId: string | null) => ({
  cursorSent,
  throughUpdateId,
});

test("a key conflict clears the cursor, whether or not the pull completed", () => {
  for (const completedPull of [undefined, completed(true, "through")]) {
    expect(
      processedCursorTransition({
        completedPull,
        keyConflict: true,
        recordedFrontier: FRONTIER,
      }),
    ).toEqual({ status: "cleared" });
  }
});

test("a page that does not end its pull leaves the cursor unchanged", () => {
  expect(
    processedCursorTransition({
      completedPull: undefined,
      keyConflict: false,
      recordedFrontier: FRONTIER,
    }),
  ).toEqual({ status: "unchanged" });
});

test("a completed pull advances to its bound at the recorded frontier", () => {
  expect(
    processedCursorTransition({
      completedPull: completed(true, "through"),
      keyConflict: false,
      recordedFrontier: FRONTIER,
    }),
  ).toEqual({
    dropsOtherJudges: false,
    status: "advanced",
    through: { updateId: "through", version: FRONTIER },
  });
  // Without a cursor the pull judged everything uncovered again.
  expect(
    processedCursorTransition({
      completedPull: completed(false, null),
      keyConflict: false,
      recordedFrontier: FRONTIER,
    }),
  ).toEqual({ dropsOtherJudges: true, status: "advanced", through: null });
});
