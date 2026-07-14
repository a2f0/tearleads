import { describe, expect, test } from "bun:test";

import { reviewExitCode } from "./prContext";

describe("reviewExitCode", () => {
  test("passes through a real exit code", () => {
    expect(reviewExitCode("claude", { status: 0, signal: null })).toBe(0);
    expect(reviewExitCode("claude", { status: 2, signal: null })).toBe(2);
  });

  test("treats a missing binary (no status) as failure", () => {
    const result = {
      status: null,
      signal: null,
      error: new Error("spawn codex ENOENT"),
    };
    expect(reviewExitCode("codex", result)).toBe(1);
  });

  test("treats signal termination as failure", () => {
    expect(reviewExitCode("codex", { status: null, signal: "SIGKILL" })).toBe(
      1,
    );
  });

  test("treats a null status with no error/signal as failure", () => {
    expect(reviewExitCode("claude", { status: null, signal: null })).toBe(1);
  });
});
