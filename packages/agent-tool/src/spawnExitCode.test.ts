import { describe, expect, test } from "bun:test";

import { spawnExitCode } from "./prContext";

describe("spawnExitCode", () => {
  test("passes through a real exit code", () => {
    expect(spawnExitCode("claude", { status: 0, signal: null })).toBe(0);
    expect(spawnExitCode("claude", { status: 2, signal: null })).toBe(2);
  });

  test("treats a missing binary (no status) as failure", () => {
    const result = {
      status: null,
      signal: null,
      error: new Error("spawn codex ENOENT"),
    };
    expect(spawnExitCode("codex", result)).toBe(1);
  });

  test("treats signal termination as failure", () => {
    expect(spawnExitCode("codex", { status: null, signal: "SIGKILL" })).toBe(1);
  });

  test("treats a null status with no error/signal as failure", () => {
    expect(spawnExitCode("claude", { status: null, signal: null })).toBe(1);
  });
});
