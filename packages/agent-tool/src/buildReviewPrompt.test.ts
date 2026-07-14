import { describe, expect, test } from "bun:test";

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
