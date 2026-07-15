import { describe, expect, test } from "bun:test";

import { REVIEW_VERDICTS, reviewOutputProblem } from "./reviewOutput";

describe("reviewOutputProblem", () => {
  test("accepts a review that signs off with a verdict", () => {
    const output = [
      "## Review: fix/example (#42)",
      "",
      "- **Blocker** `src/a.ts:10` — unchecked cast.",
      "",
      "VERDICT: BLOCKER",
    ].join("\n");

    expect(reviewOutputProblem(output)).toBeNull();
  });

  test("accepts a clean review with no findings", () => {
    expect(
      reviewOutputProblem("No issues found.\n\nVERDICT: CLEAN"),
    ).toBeNull();
  });

  test("tolerates surrounding whitespace and indentation", () => {
    expect(reviewOutputProblem("  VERDICT: MINOR  \n")).toBeNull();
  });

  test("accepts every severity the prompt asks the reviewer to use", () => {
    // A review is told to name the highest severity it found. Any severity it
    // can find, it must be able to sign off with — otherwise a review whose
    // worst finding is that severity gets discarded for reporting it honestly.
    for (const verdict of REVIEW_VERDICTS) {
      expect(
        reviewOutputProblem(`## Review\n\nVERDICT: ${verdict}`),
      ).toBeNull();
    }
  });

  test("lets a suggestion-only review sign off without inflating or denying it", () => {
    const output = [
      "## Review",
      "",
      "- **Suggestion** `src/a.ts:1` — consider a clearer name.",
      "",
      "VERDICT: SUGGESTION",
    ].join("\n");

    expect(reviewOutputProblem(output)).toBeNull();
  });

  test("rejects a bare intent sentence", () => {
    const problem = reviewOutputProblem(
      "I'll review this PR diff using the project's review guidelines.",
    );

    expect(problem).toContain("VERDICT");
    expect(problem).toContain("I'll review this PR diff");
  });

  test("rejects empty output", () => {
    expect(reviewOutputProblem("")).toContain("wrote nothing");
    expect(reviewOutputProblem("   \n  ")).toContain("wrote nothing");
  });

  test("rejects prose that merely mentions a verdict inline", () => {
    expect(
      reviewOutputProblem(
        "The VERDICT: BLOCKER would apply if I had finished.",
      ),
    ).toContain("VERDICT");
  });

  test("rejects an unknown verdict word", () => {
    expect(reviewOutputProblem("VERDICT: MAYBE")).toContain("VERDICT");
  });

  test("clips a long first line in the reported preview", () => {
    const problem = reviewOutputProblem("x".repeat(400));

    expect(problem).toContain("...");
    expect(problem?.length).toBeLessThan(260);
  });
});
