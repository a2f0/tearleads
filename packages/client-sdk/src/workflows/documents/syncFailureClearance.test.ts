import { expect, test } from "bun:test";
import { shouldClearDocumentSyncFailureAfterPass } from "./syncFailureClearance";

function completedPass(pullCursor?: string) {
  return {
    exhaustedPendingUpdateCount: 0,
    plan: { request: { pullCursor } },
  };
}

test("a cursor-only pass retains failures for writes it deferred", () => {
  expect(
    shouldClearDocumentSyncFailureAfterPass(completedPass("next-page"), 1),
  ).toBe(false);
  expect(
    shouldClearDocumentSyncFailureAfterPass(completedPass("next-page"), 0),
  ).toBe(true);
  expect(shouldClearDocumentSyncFailureAfterPass(completedPass(), 1)).toBe(
    true,
  );
});
