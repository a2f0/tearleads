import { describe, expect, test } from "bun:test";

import { REVIEW_VERDICTS } from "./reviewOutput";
import { buildReviewPrompt } from "./solicitClaudeCodeReview";

describe("buildReviewPrompt", () => {
  const context = {
    branch: "feat/example",
    repo: "owner/repo",
    prNumber: "42",
    title: "feat: example change",
    baseRef: "main",
  };

  test("embeds PR context, guidelines, and diff", () => {
    const prompt = buildReviewPrompt({
      context,
      diff: "diff --git a/x.ts b/x.ts",
      reviewInstructions: "PROJECT GUIDELINES",
    });

    expect(prompt).toContain("Branch: feat/example");
    expect(prompt).toContain("PR: #42");
    expect(prompt).toContain("Base: main");
    expect(prompt).toContain("PROJECT GUIDELINES");
    expect(prompt).toContain("diff --git a/x.ts b/x.ts");
  });

  test("names the PR as not opened yet when there is no PR number", () => {
    const prompt = buildReviewPrompt({
      context: { ...context, prNumber: "", title: "" },
      diff: "diff",
      reviewInstructions: "",
    });

    expect(prompt).toContain("PR: (not opened yet)");
    expect(prompt).not.toContain("PR: #");
  });

  test("demands a verdict line naming every allowed severity", () => {
    const prompt = buildReviewPrompt({
      context,
      diff: "diff",
      reviewInstructions: "",
    });

    expect(prompt).toContain("VERDICT: X");
    for (const verdict of REVIEW_VERDICTS) {
      expect(prompt).toContain(verdict);
    }
  });

  test("invites reading beyond the diff, but not running commands", () => {
    const prompt = buildReviewPrompt({
      context,
      diff: "diff",
      reviewInstructions: "",
    });

    expect(prompt).toContain("Read the surrounding files");
    expect(prompt).toContain(
      "do not plan to build, typecheck, or execute tests",
    );
  });

  test("tolerates missing review instructions", () => {
    const prompt = buildReviewPrompt({
      context,
      diff: "diff",
      reviewInstructions: "",
    });

    expect(prompt).toContain("## Review Guidelines");
    expect(prompt).toContain("Blocker, Major, Minor, Suggestion");
  });
});
