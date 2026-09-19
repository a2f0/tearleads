import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReviewerEnv } from "./runReview";
import { spawnOpencodeReview } from "./solicitOpencodeReview";

/**
 * Exercise the real spawn path against a stub `opencode` that behaves like the
 * real `opencode run`: TUI noise on stderr, the final message on stdout, and
 * stdin carrying the prompt. The stub also records its cwd and the confinement
 * environment, so the tests pin down that the reviewer runs *outside* the
 * snapshot with the inline config and empty config dir in place.
 */
const stubDir = mkdtempSync(path.join(tmpdir(), "agent-tool-opencode-stub-"));

// The stub shells out to `cat`, so the system paths have to stay reachable.
// They are also where a real `opencode` is *not* installed, which is what lets
// the missing-CLI case below be genuine rather than staged.
const SYSTEM_PATH = ["/bin", "/usr/bin"].join(path.delimiter);

/** An environment that finds the stub `opencode`. */
const stubEnv: ReviewerEnv = {
  PATH: [stubDir, SYSTEM_PATH].join(path.delimiter),
};

/** An environment with no `opencode` on it at all. */
const bareEnv: ReviewerEnv = { PATH: SYSTEM_PATH };

const cwdPath = path.join(stubDir, "cwd");
const configPath = path.join(stubDir, "config-content");
const configDirPath = path.join(stubDir, "config-dir");

/**
 * Install a stub `opencode` that prints `stdout` and exits with `exitCode`. The
 * payload goes through a file rather than an inlined string so newlines survive
 * the shell verbatim — the verdict line is only a verdict line if it is a line.
 */
function stubOpencode(stdout: string, exitCode = 0): void {
  const payloadPath = path.join(stubDir, "payload");
  writeFileSync(payloadPath, stdout);
  const script = [
    "#!/bin/sh",
    "cat > /dev/null", // drain the prompt on stdin, as the real CLI does
    `pwd > ${JSON.stringify(cwdPath)}`,
    `printf '%s' "$OPENCODE_CONFIG_CONTENT" > ${JSON.stringify(configPath)}`,
    `printf '%s' "$OPENCODE_CONFIG_DIR" > ${JSON.stringify(configDirPath)}`,
    "echo 'stderr noise' >&2",
    `cat ${JSON.stringify(payloadPath)}`,
    `exit ${exitCode}`,
  ].join("\n");
  const stubPath = path.join(stubDir, "opencode");
  writeFileSync(stubPath, script);
  chmodSync(stubPath, 0o755);
}

/**
 * Install a stub `opencode` that flakes exactly once — the observed failure
 * mode: a bare intent sentence under a success exit — and reviews properly
 * when called again.
 */
function stubFlakyOpencode(review: string): void {
  const payloadPath = path.join(stubDir, "payload");
  const markerPath = path.join(stubDir, "flaked-once");
  rmSync(markerPath, { force: true });
  writeFileSync(payloadPath, review);
  const script = [
    "#!/bin/sh",
    "cat > /dev/null",
    `if [ -f ${JSON.stringify(markerPath)} ]; then`,
    `  cat ${JSON.stringify(payloadPath)}`,
    "else",
    `  touch ${JSON.stringify(markerPath)}`,
    `  echo "I'll review this PR diff using the project's guidelines."`,
    "fi",
  ].join("\n");
  const stubPath = path.join(stubDir, "opencode");
  writeFileSync(stubPath, script);
  chmodSync(stubPath, 0o755);
}

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe("spawnOpencodeReview", () => {
  test("accepts a review that ends with a verdict", () => {
    stubOpencode("## Review\n\n- Minor: `a.ts:1` naming.\n\nVERDICT: MINOR\n");

    expect(spawnOpencodeReview("prompt", "high", stubDir, stubEnv)).toBe(0);
  });

  test("runs from a neutral cwd, not the snapshot", () => {
    stubOpencode("## Review\n\nAll good.\n\nVERDICT: CLEAN\n");

    expect(spawnOpencodeReview("prompt", "high", stubDir, stubEnv)).toBe(0);
    // The outDir is removed after the review, so compare basenames (immune to
    // the macOS /var vs /private/var symlink spelling) rather than realpaths.
    const cwd = readFileSync(cwdPath, "utf8").trim();
    expect(cwd.split("/").pop()?.startsWith("agent-tool-opencode-")).toBe(true);
    expect(cwd.split("/").pop()).not.toBe(stubDir.split("/").pop());
  });

  test("ships the confinement config and an empty config dir", () => {
    stubOpencode("## Review\n\nAll good.\n\nVERDICT: CLEAN\n");

    expect(spawnOpencodeReview("prompt", "high", stubDir, stubEnv)).toBe(0);
    const config = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(config) as {
      agent: Record<
        string,
        {
          permission: {
            edit: string;
            bash: string;
            webfetch: string;
            external_directory: Record<string, string>;
          };
        }
      >;
    };
    const permission = parsed.agent["tearleads-review"]?.permission ?? {
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
      external_directory: { "*": "allow" },
    };

    expect(permission.edit).toBe("deny");
    expect(permission.bash).toBe("deny");
    expect(permission.webfetch).toBe("deny");
    expect(permission.external_directory["*"]).toBe("deny");
    expect(config).toContain(`${stubDir}/**`);
    const configDir = readFileSync(configDirPath, "utf8");
    expect(configDir.split("/").pop()).toBe(
      readFileSync(cwdPath, "utf8").trim().split("/").pop(),
    );
  });

  test("rejects a bare intent sentence despite a success exit", () => {
    // The regression: opencode exits 0 having only announced what it would do.
    stubOpencode("I'll review this PR diff using the project's guidelines.\n");

    expect(spawnOpencodeReview("prompt", "high", stubDir, stubEnv)).toBe(1);
  });

  test("recovers when the degenerate output does not repeat", () => {
    // The observed flake is stochastic; one retry should absorb it.
    stubFlakyOpencode("## Review\n\nLooks fine.\n\nVERDICT: CLEAN\n");

    expect(spawnOpencodeReview("prompt", "high", stubDir, stubEnv)).toBe(0);
    expect(existsSync(path.join(stubDir, "flaked-once"))).toBe(true);
  });

  test("rejects empty output despite a success exit", () => {
    stubOpencode("");

    expect(spawnOpencodeReview("prompt", "high", stubDir, stubEnv)).toBe(1);
  });

  test("passes through a nonzero exit without second-guessing it", () => {
    stubOpencode("Credit balance too low\n", 2);

    expect(spawnOpencodeReview("prompt", "high", stubDir, stubEnv)).toBe(2);
  });

  test("reports failure when the CLI is missing entirely", () => {
    stubOpencode("VERDICT: CLEAN"); // installed, but not on bareEnv's PATH

    expect(spawnOpencodeReview("prompt", "high", stubDir, bareEnv)).toBe(1);
  });
});
