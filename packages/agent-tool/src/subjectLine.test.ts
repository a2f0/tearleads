import { describe, expect, test } from "bun:test";

import { singleLineSubject } from "./subjectLine";

describe("singleLineSubject", () => {
  test("uses the explicit value, trimmed", () => {
    expect(singleLineSubject("  feat: x  ", "fallback", "PR title")).toBe(
      "feat: x",
    );
  });

  test("falls back when the value is empty or whitespace", () => {
    expect(singleLineSubject(undefined, "feat: fallback", "PR title")).toBe(
      "feat: fallback",
    );
    expect(singleLineSubject("   ", "feat: fallback", "PR title")).toBe(
      "feat: fallback",
    );
  });

  test("throws with the noun when nothing resolves", () => {
    expect(() => singleLineSubject("", "", "PR title")).toThrow(/No PR title/);
  });

  test("rejects embedded line breaks with the noun", () => {
    expect(() => singleLineSubject("feat: x\nbody", "", "PR title")).toThrow(
      /PR title must be a single line/,
    );
  });
});
