import { expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

const repoRoot = resolve(import.meta.dir, "../../..");
const hookPath = "scripts/git/hooks/pre-push";

function pushFixture(failingCommand: string) {
  const repo = fixture();
  for (const path of [
    hookPath,
    "scripts/checkFast.sh",
    "scripts/checks/fastChecks.sh",
    "scripts/stepTimings.sh",
    "scripts/git/showPushGateTimings.sh",
    "scripts/git/install-hooks.sh",
  ]) {
    repo.write(path, readFileSync(join(repoRoot, path), "utf8"));
    chmodSync(join(repo.cwd, path), 0o755);
  }
  for (const name of [
    "checkTerraform",
    "checkCommitTrust",
    "checkBinaryFiles",
  ]) {
    const path = `scripts/checks/${name}.sh`;
    repo.write(path, "#!/bin/sh\nexit 0\n");
    chmodSync(join(repo.cwd, path), 0o755);
  }
  repo.write(
    "bin/bun",
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n' +
      '[ "$*" != "$FAILING_COMMAND" ] || exit 23\n',
  );
  chmodSync(join(repo.cwd, "bin/bun"), 0o755);
  const head = repo.commit();
  const log = join(repo.cwd, "commands.log");
  const timings = join(repo.cwd, "timings.tsv");
  const { PATH = "" } = process.env;
  const env = {
    ...repo.env,
    PATH: `${join(repo.cwd, "bin")}:${PATH}`,
    COMMAND_LOG: log,
    FAILING_COMMAND: failingCommand,
    PUSH_GATE_TIMINGS_LOG: timings,
  };
  const run = (...cmd: string[]) =>
    Bun.spawnSync(cmd, {
      cwd: repo.cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  const install = () => {
    const result = run("sh", "scripts/git/install-hooks.sh");
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  };
  install();
  // A local bare remote exercises Git's real hook invocation without a network.
  expect(run("git", "init", "--bare", "remote.git").exitCode).toBe(0);
  const push = () =>
    run("git", "push", "./remote.git", "HEAD:refs/heads/probe");
  return { ...repo, head, log, timings, run, install, push };
}

test("CI and the installed hook run the same fast checks in order", () => {
  const repo = pushFixture("run lint:markdown");
  try {
    const ci = repo.run("sh", "scripts/checkFast.sh");
    expect(ci.exitCode).toBe(23);
    const ciCommands = readFileSync(repo.log, "utf8").trim().split("\n");
    expect(ciCommands).toContain("run lint:openapi:compatibility");
    expect(ciCommands).toContain("run check:protocol-models");
    expect(ciCommands).toContain("run lint:infrastructure-parity");
    repo.write("commands.log", "");

    expect(repo.push().exitCode).not.toBe(0);
    const pushCommands = readFileSync(repo.log, "utf8").trim().split("\n");
    expect(pushCommands).toEqual(["run lint:branch-name", ...ciCommands]);
    expect(readFileSync(repo.timings, "utf8")).toContain(
      "\tunfinished=markdown\tstatus=failed\t",
    );
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("an OpenAPI compatibility failure refuses a real push and records its head", () => {
  const repo = pushFixture("run lint:openapi:compatibility");
  try {
    const result = repo.push();
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).not.toContain("All checks passed.");
    const commands = readFileSync(repo.log, "utf8");
    expect(commands).toContain("run lint:openapi:compatibility\n");
    expect(commands).not.toContain("run test:openapi:compatibility\n");
    const timings = readFileSync(repo.timings, "utf8");
    expect(timings).toContain(
      "\tunfinished=openapi-compatibility\tstatus=failed\t",
    );
    expect(timings).toContain(`\thead=${repo.head}\t`);
    expect(
      repo.run(
        "git",
        "--git-dir=remote.git",
        "show-ref",
        "--verify",
        "refs/heads/probe",
      ).exitCode,
    ).not.toBe(0);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("a successful gate pushes the ref and records all checks", () => {
  const repo = pushFixture("");
  try {
    const result = repo.push();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("All checks passed.");
    expect(
      repo
        .run("git", "--git-dir=remote.git", "rev-parse", "refs/heads/probe")
        .stdout.toString()
        .trim(),
    ).toBe(repo.head);
    const timings = readFileSync(repo.timings, "utf8");
    expect(timings).toContain("\tstatus=passed\t");
    expect(timings).toContain("step\topenapi-compatibility\t");
    expect(timings).toContain("step\ttests\t");
    expect(timings).not.toContain("unfinished=");
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("stale installed hooks block until the installer refreshes them", () => {
  const repo = pushFixture("run lint:openapi:compatibility");
  try {
    repo.write(
      hookPath,
      `${readFileSync(join(repo.cwd, hookPath), "utf8")}\n# Updated hook\n`,
    );
    const stale = repo.push();
    expect(stale.exitCode).not.toBe(0);
    expect(stale.stderr.toString()).toContain(
      "pre-push hook is stale. Run sh scripts/git/install-hooks.sh.",
    );
    repo.install();
    const refreshed = repo.push();
    expect(refreshed.exitCode).not.toBe(0);
    expect(refreshed.stderr.toString()).not.toContain("hook is stale");
    expect(refreshed.stdout.toString()).toContain("[openapi-compatibility]");
    expect(readFileSync(join(repo.cwd, ".git/hooks/pre-push"), "utf8")).toBe(
      readFileSync(join(repo.cwd, hookPath), "utf8"),
    );
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});
