import { describe, expect, test } from "bun:test";

import { assertBranchPushed } from "./assertBranchPushed";

describe("assertBranchPushed", () => {
  test("accepts a branch pushed at the local head", () => {
    expect(() =>
      assertBranchPushed({ branch: "b", localHead: "abc", remoteHead: "abc" }),
    ).not.toThrow();
  });

  test("names the push the caller owes when the branch is absent", () => {
    expect(() =>
      assertBranchPushed({ branch: "b", localHead: "abc", remoteHead: null }),
    ).toThrow(/openPr does not push; run 'git push -u origin b' first/);
  });

  test("refuses a remote head that is not the local one", () => {
    expect(() =>
      assertBranchPushed({ branch: "b", localHead: "abc", remoteHead: "def" }),
    ).toThrow(/at def on the repository but abc locally/);
  });
});
