import { describe, expect, test } from "bun:test";

import { buildCodexReviewArgs } from "./solicitCodexReview";

describe("buildCodexReviewArgs", () => {
  const base = { baseRef: "main", branch: "feat/example" };

  test("pins the effort and base, and titles by PR when one exists", () => {
    const args = buildCodexReviewArgs({ ...base, prNumber: "42" }, "high");

    expect(args).toEqual([
      "review",
      "-c",
      'model_reasoning_effort="high"',
      "--base",
      "main",
      "--title",
      "PR #42 (feat/example)",
    ]);
  });

  test("titles by branch alone before the PR is opened", () => {
    const args = buildCodexReviewArgs({ ...base, prNumber: "" }, "xhigh");

    expect(args.at(-1)).toBe("Branch feat/example");
    expect(args.join(" ")).not.toContain("PR #");
  });
});
