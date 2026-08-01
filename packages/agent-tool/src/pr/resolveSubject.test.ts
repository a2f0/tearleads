import { describe, expect, test } from "bun:test";

import { resolveSubject } from "./squashMerge";

describe("resolveSubject", () => {
  test("uses the explicit subject, trimmed", () => {
    expect(resolveSubject("  feat: add thing  ", "feat: pr title")).toBe(
      "feat: add thing",
    );
  });

  test("falls back to the PR title when no subject is given", () => {
    expect(resolveSubject(undefined, "feat: pr title")).toBe("feat: pr title");
    expect(resolveSubject("   ", "feat: pr title")).toBe("feat: pr title");
  });

  test("throws when both the subject and PR title are empty", () => {
    expect(() => resolveSubject("", "")).toThrow(/No squash subject/);
  });

  test("rejects a subject with an embedded newline", () => {
    expect(() => resolveSubject("feat: ok\nsneaky body", "")).toThrow(
      /single line/,
    );
    expect(() => resolveSubject("feat: ok\r\nbody", "")).toThrow(/single line/);
  });
});
