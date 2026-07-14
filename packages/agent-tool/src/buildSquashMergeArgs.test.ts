import { describe, expect, test } from "bun:test";

import { buildSquashMergeArgs } from "./squashMerge";

const pr = { prNumber: "1537", repo: "a2f0/tearleads" };

describe("buildSquashMergeArgs", () => {
  test("builds a subject-only squash with an empty body", () => {
    expect(buildSquashMergeArgs(pr, "feat(app): add widget (#1537)")).toEqual([
      "pr",
      "merge",
      "1537",
      "--squash",
      "--subject",
      "feat(app): add widget (#1537)",
      "--body",
      "",
      "-R",
      "a2f0/tearleads",
    ]);
  });

  test("omits --match-head-commit when no head SHA is given", () => {
    const args = buildSquashMergeArgs(pr, "feat: x (#1537)");
    expect(args).not.toContain("--match-head-commit");
  });

  test("binds the merge to the head SHA when provided", () => {
    const args = buildSquashMergeArgs(pr, "feat: x (#1537)", "abc123");
    const flagIndex = args.indexOf("--match-head-commit");
    expect(flagIndex).toBeGreaterThan(-1);
    expect(args[flagIndex + 1]).toBe("abc123");
  });

  test("treats an empty head SHA as absent", () => {
    const args = buildSquashMergeArgs(pr, "feat: x (#1537)", "");
    expect(args).not.toContain("--match-head-commit");
  });
});
