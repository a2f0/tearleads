import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MAX_REVIEW_ATTEMPTS, type ReviewerEnv } from "./runReview";
import { spawnCodexReview } from "./solicitCodexReview";

/**
 * Exercise the real spawn path against a stub `codex` that behaves like the
 * real `codex exec`: transcript noise on stderr, chatter on stdout, and the
 * final message written to the `--output-last-message` file. What these tests
 * pin down is that the *file* is the review — the streams never are.
 */
const stubDir = mkdtempSync(path.join(tmpdir(), "agent-tool-codex-stub-"));

const SYSTEM_PATH = ["/bin", "/usr/bin"].join(path.delimiter);
const STUB_PATH = [stubDir, SYSTEM_PATH].join(path.delimiter);

/** An environment that finds the stub `codex`. */
const stubEnv: ReviewerEnv = { PATH: STUB_PATH };

const countPath = path.join(stubDir, "count");
const markerPath = path.join(stubDir, "flaked-once");
const cwdPath = path.join(stubDir, "cwd");

/**
 * Install a stub `codex` that writes `review` to whatever file follows
 * `--output-last-message`, appends to a count file per invocation, and noises
 * up both streams the way the real CLI does. With `flakyOnce`, the first call
 * writes a bare intent sentence instead — the degenerate-review failure mode.
 */
function stubCodex(
  review: string,
  opts: { exitCode?: number; flakyOnce?: boolean } = {},
): void {
  const payloadPath = path.join(stubDir, "payload");
  writeFileSync(payloadPath, review);
  rmSync(countPath, { force: true });
  rmSync(markerPath, { force: true });
  rmSync(cwdPath, { force: true });
  const writeReview = opts.flakyOnce
    ? [
        `if [ -f ${JSON.stringify(markerPath)} ]; then`,
        `  cp ${JSON.stringify(payloadPath)} "$out"`,
        "else",
        `  touch ${JSON.stringify(markerPath)}`,
        `  echo "I'll review this PR diff." > "$out"`,
        "fi",
      ]
    : [`cp ${JSON.stringify(payloadPath)} "$out"`];
  const script = [
    "#!/bin/sh",
    "cat > /dev/null", // drain the prompt on stdin, as the real CLI does
    `pwd > ${JSON.stringify(cwdPath)}`,
    `printf 'x\\n' >> ${JSON.stringify(countPath)}`,
    'out=""',
    'prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi',
    '  prev="$a"',
    "done",
    'echo "session transcript noise" >&2',
    'echo "stdout chatter"',
    ...writeReview,
    `exit ${opts.exitCode ?? 0}`,
  ].join("\n");
  const stubPath = path.join(stubDir, "codex");
  writeFileSync(stubPath, script);
  chmodSync(stubPath, 0o755);
}

/** How many times the stub has been invoked since it was (re)installed. */
function attempts(): number {
  try {
    return readFileSync(countPath, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe("spawnCodexReview", () => {
  test("accepts a verdict-signed last message on the first attempt", () => {
    stubCodex("## Review\n\n- Minor: `a.ts:1` naming.\n\nVERDICT: MINOR\n");

    expect(spawnCodexReview("prompt", "high", stubDir, stubEnv)).toBe(0);
    expect(attempts()).toBe(1);
  });

  test("relays the last message alone — never the transcript", () => {
    const review = "## Review\n\nAll good.\n\nVERDICT: CLEAN\n";
    stubCodex(review);

    // Drive the real export from a child process so fd 1 is a genuine pipe,
    // exactly as a calling agent captures it.
    const runnerPath = path.join(stubDir, "runner.ts");
    const modulePath = path.join(import.meta.dir, "solicitCodexReview.ts");
    writeFileSync(
      runnerPath,
      [
        `import { spawnCodexReview } from ${JSON.stringify(modulePath)};`,
        `const code = spawnCodexReview("prompt", "high", ${JSON.stringify(stubDir)}, { PATH: ${JSON.stringify(STUB_PATH)} });`,
        `process.exit(code);`,
      ].join("\n"),
    );

    const relayed = execFileSync("bun", [runnerPath], { encoding: "utf8" });

    expect(relayed).toBe(review);
  });

  test("runs outside the reviewed repository", () => {
    stubCodex("## Review\n\nAll good.\n\nVERDICT: CLEAN\n");

    expect(spawnCodexReview("prompt", "high", stubDir, stubEnv)).toBe(0);
    expect(readFileSync(cwdPath, "utf8").trim()).not.toBe(stubDir);
  });

  test("retries once, then rejects a last message with no verdict", () => {
    stubCodex("A rambling investigation that never concludes.\n");

    expect(spawnCodexReview("prompt", "high", stubDir, stubEnv)).toBe(1);
    expect(attempts()).toBe(MAX_REVIEW_ATTEMPTS);
  });

  test("recovers when the degenerate output does not repeat", () => {
    stubCodex("## Review\n\nFine.\n\nVERDICT: CLEAN\n", { flakyOnce: true });

    expect(spawnCodexReview("prompt", "high", stubDir, stubEnv)).toBe(0);
    expect(attempts()).toBe(2);
  });

  test("passes through a nonzero exit without retrying", () => {
    stubCodex("VERDICT: CLEAN\n", { exitCode: 2 });

    expect(spawnCodexReview("prompt", "high", stubDir, stubEnv)).toBe(2);
    expect(attempts()).toBe(1);
  });
});
