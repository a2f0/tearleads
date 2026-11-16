import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "waitForCi.sh");
const commit = "a".repeat(40);
const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A fake `gh`: `run list` answers with RUN_IDS, one line per call, then the
// last line forever; `run watch` exits with WATCH_STATUS.
const fakeGh = `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_LOG"
case "$1 $2" in
  "run list")
    calls=$(grep -c '^run list' "$GH_LOG")
    printf '%s\\n' "$RUN_IDS" | sed -n "$calls{p;q;}" > "$GH_LOG.answer"
    [ -s "$GH_LOG.answer" ] || printf '%s\\n' "$RUN_IDS" | tail -n 1 > "$GH_LOG.answer"
    cat "$GH_LOG.answer"
    ;;
  "run watch") exit "$WATCH_STATUS" ;;
esac
`;

function waitForCi(runIds: string, watchStatus: number) {
  const directory = mkdtempSync(join(tmpdir(), "waitForCi-"));
  fixtures.push(directory);
  const bin = join(directory, "bin");
  const log = join(directory, "gh.log");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), fakeGh);
  chmodSync(join(bin, "gh"), 0o755);
  const result = Bun.spawnSync(["sh", script, commit], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "owner/repo",
      GH_LOG: log,
      RUN_IDS: runIds,
      WATCH_STATUS: String(watchStatus),
      CI_WAIT_ATTEMPTS: "3",
      CI_WAIT_INTERVAL: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n");
  } catch {}
  return {
    code: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
    calls,
  };
}

test("waits for main's CI run on the commit and passes when it passes", () => {
  // The run appears on the second look.
  const result = waitForCi("\n42", 0);
  expect(result.code, result.output).toBe(0);
  expect(result.calls).toEqual([
    `run list --repo owner/repo --workflow ci.yml --branch main --commit ${commit} --limit 1 --json databaseId --jq .[0].databaseId // empty`,
    `run list --repo owner/repo --workflow ci.yml --branch main --commit ${commit} --limit 1 --json databaseId --jq .[0].databaseId // empty`,
    "run watch 42 --repo owner/repo --exit-status --interval 30",
  ]);
});

test("fails when CI fails, so the publish never starts", () => {
  const result = waitForCi("42", 1);
  expect(result.code).toBe(1);
  expect(result.output).toContain("Waiting for CI run 42");
});

test("gives up when no CI run appears", () => {
  const result = waitForCi("", 0);
  expect(result.code).toBe(1);
  expect(result.output).toContain("No CI run on main for");
  expect(
    result.calls.filter((call) => call.startsWith("run list")),
  ).toHaveLength(3);
});
