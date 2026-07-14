import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

import { validateCommitSubject } from "./validateCommitSubject";

const rootDir = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

describe("validateCommitSubject", () => {
  test("accepts a valid conventional subject", () => {
    expect(() =>
      validateCommitSubject(rootDir, "feat(agent-tool): add squash merge"),
    ).not.toThrow();
  });

  test("accepts the repo's custom 'cleanup' type", () => {
    expect(() =>
      validateCommitSubject(rootDir, "cleanup: drop dead code"),
    ).not.toThrow();
  });

  test("rejects a non-conventional subject", () => {
    expect(() => validateCommitSubject(rootDir, "just some text")).toThrow(
      /commitlint/,
    );
  });

  test("rejects an unknown type", () => {
    expect(() =>
      validateCommitSubject(rootDir, "frobnicate: do a thing"),
    ).toThrow(/commitlint/);
  });

  test("enforces the repo's 50-char header limit", () => {
    const tooLong = `feat(agent-tool): ${"x".repeat(50)}`;
    expect(() => validateCommitSubject(rootDir, tooLong)).toThrow(/commitlint/);
  });
});
