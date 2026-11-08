import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "installDependencies.sh");

/**
 * Runs the install script with stub `bun` and `sleep` on PATH. The `bun` stub
 * fails its first `failures` calls; every call to either stub is logged, so a
 * test sees each install attempt and each backoff without waiting for it.
 */
function runInstall(failures: number) {
  const bin = mkdtempSync(join(tmpdir(), "installDependencies-"));
  const calls = join(bin, "calls.log");
  writeFileSync(calls, "");
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/sh
printf 'bun %s\\n' "$*" >>"${calls}"
attempt=$(grep -c '^bun ' "${calls}")
[ "$attempt" -gt ${failures} ]
`,
  );
  writeFileSync(
    join(bin, "sleep"),
    `#!/bin/sh\nprintf 'sleep %s\\n' "$1" >>"${calls}"\n`,
  );
  chmodSync(join(bin, "bun"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);
  const { PATH: path = "" } = process.env;
  const result = Bun.spawnSync({
    cmd: ["sh", script],
    env: { ...process.env, PATH: `${bin}:${path}` },
  });
  return {
    calls: readFileSync(calls, "utf8").trim().split("\n"),
    exitCode: result.exitCode,
  };
}

const install = "bun install --frozen-lockfile";

test("a clean install runs once", () => {
  expect(runInstall(0)).toEqual({ calls: [install], exitCode: 0 });
});

test("a transient failure is retried after a backoff", () => {
  expect(runInstall(2)).toEqual({
    calls: [install, "sleep 15", install, "sleep 30", install],
    exitCode: 0,
  });
});

test("the install fails after three failed attempts", () => {
  expect(runInstall(3)).toEqual({
    calls: [install, "sleep 15", install, "sleep 30", install],
    exitCode: 1,
  });
});
