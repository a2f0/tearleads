import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReviewerEnv } from "./runReview";
import { spawnClaudeReview } from "./solicitClaudeCodeReview";

/**
 * Exercise the real spawn path against a stub `claude`, so the wiring between
 * "what the CLI printed" and "did we accept it" is covered rather than assumed.
 */
const stubDir = mkdtempSync(path.join(tmpdir(), "agent-tool-claude-stub-"));

// The stub shells out to `cat`, so the system paths have to stay reachable.
// They are also where a real `claude` is *not* installed, which is what lets the
// missing-CLI case below be genuine rather than staged.
const SYSTEM_PATH = ["/bin", "/usr/bin"].join(path.delimiter);

/** An environment that finds the stub `claude`. */
const stubEnv: ReviewerEnv = {
  PATH: [stubDir, SYSTEM_PATH].join(path.delimiter),
};

/** An environment with no `claude` on it at all. */
const bareEnv: ReviewerEnv = { PATH: SYSTEM_PATH };
const cwdPath = path.join(stubDir, "cwd");

/**
 * Install a stub `claude` that prints `stdout` and exits with `exitCode`. The
 * payload goes through a file rather than an inlined string so newlines survive
 * the shell verbatim — the verdict line is only a verdict line if it is a line.
 */
function stubClaude(stdout: string, exitCode = 0): void {
  const payloadPath = path.join(stubDir, "payload");
  writeFileSync(payloadPath, stdout);
  const script = [
    "#!/bin/sh",
    "cat > /dev/null", // drain the prompt on stdin, as the real CLI does
    `pwd > ${JSON.stringify(cwdPath)}`,
    `cat ${JSON.stringify(payloadPath)}`,
    `exit ${exitCode}`,
  ].join("\n");
  const stubPath = path.join(stubDir, "claude");
  writeFileSync(stubPath, script);
  chmodSync(stubPath, 0o755);
}

/**
 * Install a stub `claude` that flakes exactly once — the observed failure mode:
 * a bare intent sentence under a success exit — and reviews properly when
 * called again.
 */
function stubFlakyClaude(review: string): void {
  const payloadPath = path.join(stubDir, "payload");
  const markerPath = path.join(stubDir, "flaked-once");
  rmSync(markerPath, { force: true });
  writeFileSync(payloadPath, review);
  const script = [
    "#!/bin/sh",
    "cat > /dev/null",
    `pwd > ${JSON.stringify(cwdPath)}`,
    `if [ -f ${JSON.stringify(markerPath)} ]; then`,
    `  cat ${JSON.stringify(payloadPath)}`,
    "else",
    `  touch ${JSON.stringify(markerPath)}`,
    `  echo "I'll review this PR diff using the project's guidelines."`,
    "fi",
  ].join("\n");
  const stubPath = path.join(stubDir, "claude");
  writeFileSync(stubPath, script);
  chmodSync(stubPath, 0o755);
}

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe("spawnClaudeReview", () => {
  test("accepts a review that ends with a verdict", () => {
    stubClaude("## Review\n\n- Minor: `a.ts:1` naming.\n\nVERDICT: MINOR\n");

    expect(spawnClaudeReview("prompt", "xhigh", stubDir, stubEnv)).toBe(0);
    expect(realpathSync(readFileSync(cwdPath, "utf8").trim())).toBe(
      realpathSync(stubDir),
    );
  });

  test("rejects a bare intent sentence despite a success exit", () => {
    // The regression: claude exits 0 having only announced what it would do.
    stubClaude("I'll review this PR diff using the project's guidelines.\n");

    expect(spawnClaudeReview("prompt", "xhigh", stubDir, stubEnv)).toBe(1);
  });

  test("recovers when the degenerate output does not repeat", () => {
    // The observed flake is stochastic; one retry should absorb it.
    stubFlakyClaude("## Review\n\nLooks fine.\n\nVERDICT: CLEAN\n");

    expect(spawnClaudeReview("prompt", "xhigh", stubDir, stubEnv)).toBe(0);
    expect(existsSync(path.join(stubDir, "flaked-once"))).toBe(true);
  });

  test("rejects empty output despite a success exit", () => {
    stubClaude("");

    expect(spawnClaudeReview("prompt", "xhigh", stubDir, stubEnv)).toBe(1);
  });

  test("passes through a nonzero exit without second-guessing it", () => {
    stubClaude("Credit balance too low\n", 2);

    expect(spawnClaudeReview("prompt", "xhigh", stubDir, stubEnv)).toBe(2);
  });

  test("reports failure when the CLI is missing entirely", () => {
    stubClaude("VERDICT: CLEAN"); // installed, but not on bareEnv's PATH

    expect(spawnClaudeReview("prompt", "xhigh", stubDir, bareEnv)).toBe(1);
  });
});
