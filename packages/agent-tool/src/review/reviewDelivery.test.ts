import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `spawnClaudeReview` has two jobs: judge the review, and relay it. The exit-code
 * tests cover judging. This covers relaying, and it has to spend a real
 * subprocess to do it — the failure it guards only appears when fd 1 is a genuine
 * pipe and the payload outruns the 64 KiB pipe buffer. Asserting in-process, or
 * against a redirected file, passes while the review is being truncated.
 */
const workDir = mkdtempSync(path.join(tmpdir(), "agent-tool-delivery-"));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** A review comfortably larger than the pipe buffer, signed at the very end. */
function buildLargeReview(): string {
  const findings = Array.from(
    { length: 4000 },
    (_, i) => `- **Minor** \`src/file${i}.ts:${i}\` — placeholder finding.`,
  ).join("\n");
  return `## Review\n\n${findings}\n\nVERDICT: MAJOR\n`;
}

describe("review delivery", () => {
  test("relays a review larger than the pipe buffer without truncating it", () => {
    const review = buildLargeReview();
    expect(review.length).toBeGreaterThan(64 * 1024);

    const payloadPath = path.join(workDir, "payload");
    writeFileSync(payloadPath, review);

    const stubPath = path.join(workDir, "claude");
    writeFileSync(
      stubPath,
      [
        "#!/bin/sh",
        "cat > /dev/null",
        `cat ${JSON.stringify(payloadPath)}`,
      ].join("\n"),
    );
    chmodSync(stubPath, 0o755);

    // Drive the real export from a child process so fd 1 is a true pipe and
    // `process.exit` runs for real, exactly as `index.ts` invokes it.
    const runnerPath = path.join(workDir, "runner.ts");
    const modulePath = path.join(import.meta.dir, "solicitClaudeCodeReview.ts");
    writeFileSync(
      runnerPath,
      [
        `import { spawnClaudeReview } from ${JSON.stringify(modulePath)};`,
        `const code = spawnClaudeReview("prompt", "xhigh", { PATH: ${JSON.stringify(`${workDir}:/bin:/usr/bin`)} });`,
        `process.exit(code);`,
      ].join("\n"),
    );

    // Through a real shell pipe, not execFileSync's capture: only a genuine pipe
    // on fd 1 exposes the drop, and `| cat` is what makes it one. Capturing the
    // runner directly reads back all 200+ KB even while the bug is live.
    const relayed = execFileSync(
      "sh",
      ["-c", `bun ${JSON.stringify(runnerPath)} | cat`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    expect(relayed.length).toBe(review.length);
    expect(relayed.trimEnd().endsWith("VERDICT: MAJOR")).toBe(true);
  });
});
